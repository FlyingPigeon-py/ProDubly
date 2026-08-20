use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::Command;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const R2_BASE: &str = "https://pub-d3643445511f4a59b7c1923785cafa51.r2.dev/mods/dub";
const INDEX_URL: &str = "https://choicervoicer.com/pack-index.json";

#[derive(Clone, Serialize)]
struct DownloadProgress {
    slug: String,
    received: u64,
    total: u64,
}

#[derive(Clone, Serialize)]
struct ImportProgress {
    slug: String,
    step: String,
    done: usize,
    total: usize,
}

#[derive(Serialize)]
struct MediaEntry {
    base: String,
    rel: String,
    duration: f64,
}

#[derive(Serialize)]
struct ImportReport {
    video: String,
    video_duration: f64,
    backing: Option<String>,
    icon: Option<String>,
    cover: Option<String>,
    pack_info: String,
    lines: Vec<LineEntry>,
}

#[derive(Serialize)]
struct LineEntry {
    base: String,
    audio: String,
    duration: f64,
    image: Option<String>,
    meta: String,
}

fn packs_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("packs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn safe_slug(slug: &str) -> Result<(), String> {
    if slug.is_empty()
        || !slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("недопустимое имя пака: {slug}"));
    }
    Ok(())
}

fn safe_rel(rel: &str) -> Result<(), String> {
    if rel.split('/').any(|p| p == ".." || p.is_empty()) {
        return Err(format!("недопустимый путь: {rel}"));
    }
    Ok(())
}

fn ffmpeg_path() -> Result<PathBuf, String> {
    for cand in [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ] {
        let p = PathBuf::from(cand);
        if p.exists() {
            return Ok(p);
        }
    }
    Err("ffmpeg не найден — установите его (brew install ffmpeg)".into())
}

fn ffprobe_path() -> Result<PathBuf, String> {
    for cand in [
        "/opt/homebrew/bin/ffprobe",
        "/usr/local/bin/ffprobe",
        "/usr/bin/ffprobe",
    ] {
        let p = PathBuf::from(cand);
        if p.exists() {
            return Ok(p);
        }
    }
    Err("ffprobe не найден".into())
}

fn probe_duration(file: &Path) -> Result<f64, String> {
    let out = Command::new(ffprobe_path()?)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(file)
        .output()
        .map_err(|e| e.to_string())?;
    let s = String::from_utf8_lossy(&out.stdout);
    s.trim()
        .parse::<f64>()
        .map_err(|_| format!("не смог измерить длительность {}", file.display()))
}

fn run_ffmpeg(args: &[&str], input: &Path, output: &Path) -> Result<(), String> {
    let status = Command::new(ffmpeg_path()?)
        .arg("-y")
        .arg("-i")
        .arg(input)
        .args(args)
        .arg(output)
        .output()
        .map_err(|e| e.to_string())?;
    if !status.status.success() {
        return Err(format!(
            "ffmpeg упал на {}: {}",
            input.display(),
            String::from_utf8_lossy(&status.stderr)
                .lines()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .join(" | ")
        ));
    }
    Ok(())
}

#[tauri::command]
async fn fetch_pack_index(app: AppHandle) -> Result<String, String> {
    let cache = packs_root(&app)?.join("pack-index.json");
    let client = reqwest::Client::new();
    match client.get(INDEX_URL).send().await {
        Ok(resp) if resp.status().is_success() => {
            let text = resp.text().await.map_err(|e| e.to_string())?;
            let _ = fs::write(&cache, &text);
            Ok(text)
        }
        _ => fs::read_to_string(&cache)
            .map_err(|_| "каталог недоступен, а кэша ещё нет — проверьте сеть".to_string()),
    }
}

#[tauri::command]
async fn download_pack(app: AppHandle, slug: String) -> Result<(), String> {
    safe_slug(&slug)?;
    let url = format!("{R2_BASE}/{slug}/download/{slug}.zip");
    let zip_path = packs_root(&app)?.join(format!("{slug}.zip"));

    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("сервер ответил {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if last_emit.elapsed().as_millis() > 80 {
            last_emit = std::time::Instant::now();
            let _ = app.emit(
                "download-progress",
                DownloadProgress {
                    slug: slug.clone(),
                    received,
                    total,
                },
            );
        }
    }
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            slug: slug.clone(),
            received,
            total,
        },
    );

    let src_dir = packs_root(&app)?.join(&slug).join("src");
    let zip_for_task = zip_path.clone();
    tauri::async_runtime::spawn_blocking(move || unzip_flat(&zip_for_task, &src_dir))
        .await
        .map_err(|e| e.to_string())??;
    let _ = fs::remove_file(&zip_path);
    Ok(())
}

fn unzip_flat(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut roots: Vec<String> = vec![];
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if let Some(path) = entry.enclosed_name() {
            if let Some(first) = path.components().next() {
                let name = first.as_os_str().to_string_lossy().to_string();
                if !roots.contains(&name) {
                    roots.push(name);
                }
            }
        }
    }
    let strip_root = roots.len() == 1;

    if dest.exists() {
        fs::remove_dir_all(dest).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(path) = entry.enclosed_name() else {
            continue;
        };
        let rel: PathBuf = if strip_root {
            path.components().skip(1).collect()
        } else {
            path.to_path_buf()
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let name = rel.file_name().unwrap_or_default().to_string_lossy();
        if name.starts_with("__MACOSX") || name == ".DS_Store" {
            continue;
        }
        let out_path = dest.join(&rel);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn import_pack(app: AppHandle, slug: String) -> Result<ImportReport, String> {
    safe_slug(&slug)?;
    let pack_dir = packs_root(&app)?.join(&slug);
    let src = pack_dir.join("src");
    tauri::async_runtime::spawn_blocking(move || import_pack_sync(app, slug, pack_dir, src))
        .await
        .map_err(|e| e.to_string())?
}

fn import_pack_sync(
    app: AppHandle,
    slug: String,
    pack_dir: PathBuf,
    src: PathBuf,
) -> Result<ImportReport, String> {
    let entries: Vec<PathBuf> = fs::read_dir(&src)
        .map_err(|_| "папка пака не найдена — скачайте его заново".to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect();

    let find = |name: &str| -> Option<PathBuf> {
        entries
            .iter()
            .find(|p| {
                p.file_name()
                    .map(|f| f.to_string_lossy().eq_ignore_ascii_case(name))
                    .unwrap_or(false)
            })
            .cloned()
    };

    let video_src = find("dub_video.ogv")
        .or_else(|| {
            entries
                .iter()
                .find(|p| {
                    matches!(
                        p.extension().map(|e| e.to_string_lossy().to_lowercase()),
                        Some(ref x) if ["ogv", "mp4", "webm", "mov"].contains(&x.as_str())
                    )
                })
                .cloned()
        })
        .ok_or("в паке нет файла видео (dub_video.ogv)".to_string())?;

    let pack_info_path = find("_pack_info.ini").ok_or("в паке нет _pack_info.ini".to_string())?;
    let pack_info = fs::read_to_string(&pack_info_path).map_err(|e| e.to_string())?;

    let backing_src = entries
        .iter()
        .find(|p| {
            p.file_stem()
                .map(|f| f.to_string_lossy().to_lowercase() == "_backing_track")
                .unwrap_or(false)
        })
        .cloned();

    let icon = entries
        .iter()
        .find(|p| {
            p.file_stem()
                .map(|f| f.to_string_lossy().to_lowercase() == "icon")
                .unwrap_or(false)
                && p.extension()
                    .map(|e| e.to_string_lossy().to_lowercase() == "png")
                    .unwrap_or(false)
        })
        .map(|p| format!("src/{}", p.file_name().unwrap().to_string_lossy()));

    let audio_exts = ["mp3", "ogg", "wav", "m4a", "flac"];
    let mut line_audio: Vec<PathBuf> = entries
        .iter()
        .filter(|p| {
            let stem = p
                .file_stem()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();
            let ext = p
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            audio_exts.contains(&ext.as_str()) && !stem.starts_with('_')
        })
        .cloned()
        .collect();
    line_audio.sort();

    let total_steps = line_audio.len() + 1 + backing_src.iter().count();
    let mut done_steps = 0usize;
    let mut emit_progress = |step: &str, done: usize| {
        let _ = app.emit(
            "import-progress",
            ImportProgress {
                slug: slug.clone(),
                step: step.to_string(),
                done,
                total: total_steps,
            },
        );
    };

    emit_progress("видео", 0);
    let video_out = pack_dir.join("video.mp4");
    let needs_transcode = video_src
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase() != "mp4")
        .unwrap_or(true);
    if needs_transcode {
        run_ffmpeg(
            &[
                "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
            ],
            &video_src,
            &video_out,
        )?;
    } else {
        fs::copy(&video_src, &video_out).map_err(|e| e.to_string())?;
    }
    let video_duration = probe_duration(&video_out)?;
    done_steps += 1;
    emit_progress("видео готово", done_steps);

    let cover_out = pack_dir.join("cover.jpg");
    let cover = Command::new(ffmpeg_path()?)
        .arg("-y")
        .args(["-ss", &format!("{:.2}", video_duration * 0.25)])
        .arg("-i")
        .arg(&video_out)
        .args(["-frames:v", "1", "-q:v", "4"])
        .arg(&cover_out)
        .output()
        .ok()
        .filter(|o| o.status.success() && cover_out.exists())
        .map(|_| "cover.jpg".to_string());

    let backing = if let Some(b) = &backing_src {
        let out = pack_dir.join("backing.m4a");
        run_ffmpeg(&["-vn", "-c:a", "aac", "-b:a", "192k"], b, &out)?;
        done_steps += 1;
        emit_progress("фонограмма", done_steps);
        Some("backing.m4a".to_string())
    } else {
        None
    };

    let lines_dir = pack_dir.join("lines");
    fs::create_dir_all(&lines_dir).map_err(|e| e.to_string())?;
    let mut lines: Vec<LineEntry> = vec![];
    for audio in &line_audio {
        let base = audio.file_stem().unwrap().to_string_lossy().to_string();
        let out = lines_dir.join(format!("{base}.m4a"));
        run_ffmpeg(&["-vn", "-c:a", "aac", "-b:a", "160k"], audio, &out)?;
        let duration = probe_duration(&out)?;

        let meta_path = [format!("{base}.txt"), format!("{base}.ini")]
            .iter()
            .filter_map(|n| find(n.as_str()))
            .next();
        let meta = meta_path
            .map(|p| fs::read_to_string(p).unwrap_or_default())
            .unwrap_or_default();
        let image = find(&format!("{base}.png")).map(|p| {
            format!("src/{}", p.file_name().unwrap().to_string_lossy())
        });

        done_steps += 1;
        emit_progress(&format!("реплика {base}"), done_steps);
        lines.push(LineEntry {
            base: base.clone(),
            audio: format!("lines/{base}.m4a"),
            duration,
            image,
            meta,
        });
    }

    Ok(ImportReport {
        video: "video.mp4".to_string(),
        video_duration,
        backing,
        icon,
        cover,
        pack_info,
        lines,
    })
}

#[tauri::command]
async fn export_video(app: AppHandle, slug: String, title: String) -> Result<String, String> {
    safe_slug(&slug)?;
    let pack_dir = packs_root(&app)?.join(&slug);
    let video = pack_dir.join("video.mp4");
    let mix = pack_dir.join("mix.wav");
    if !mix.exists() {
        return Err("сначала сведите дубляж — mix.wav ещё нет".into());
    }
    let safe_title: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    let out = downloads.join(format!("{} — дубль.mp4", safe_title.trim()));

    let ffmpeg = ffmpeg_path()?;
    tauri::async_runtime::spawn_blocking(move || {
        let res = Command::new(ffmpeg)
            .arg("-y")
            .arg("-i")
            .arg(&video)
            .arg("-i")
            .arg(&mix)
            .args(["-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"])
            .arg(&out)
            .output()
            .map_err(|e| e.to_string())?;
        if !res.status.success() {
            return Err(format!(
                "ffmpeg не собрал файл: {}",
                String::from_utf8_lossy(&res.stderr).lines().rev().take(3).collect::<Vec<_>>().join(" | ")
            ));
        }
        Ok(out.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn delete_pack(app: AppHandle, slug: String) -> Result<(), String> {
    safe_slug(&slug)?;
    let dir = packs_root(&app)?.join(&slug);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_packs_dir(app: AppHandle) -> Result<String, String> {
    Ok(packs_root(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
fn list_imported(app: AppHandle) -> Result<Vec<String>, String> {
    let root = packs_root(&app)?;
    let mut out = vec![];
    if let Ok(rd) = fs::read_dir(&root) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() && p.join("pack.json").exists() {
                out.push(e.file_name().to_string_lossy().to_string());
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn read_pack_text(app: AppHandle, slug: String, rel: String) -> Result<String, String> {
    safe_slug(&slug)?;
    safe_rel(&rel)?;
    fs::read_to_string(packs_root(&app)?.join(&slug).join(&rel)).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_pack_text(app: AppHandle, slug: String, rel: String, content: String) -> Result<(), String> {
    safe_slug(&slug)?;
    safe_rel(&rel)?;
    let path = packs_root(&app)?.join(&slug).join(&rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

fn pct_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[tauri::command]
fn write_pack_binary(app: AppHandle, request: tauri::ipc::Request) -> Result<(), String> {
    let header = |name: &str| -> Result<String, String> {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| pct_decode(s))
            .ok_or_else(|| format!("нет заголовка {name}"))
    };
    let slug = header("slug")?;
    let rel = header("rel")?;
    safe_slug(&slug)?;
    safe_rel(&rel)?;
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("ожидались бинарные данные".into());
    };
    let path = packs_root(&app)?.join(&slug).join(&rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_pack_file(app: AppHandle, slug: String, rel: String) -> Result<(), String> {
    safe_slug(&slug)?;
    safe_rel(&rel)?;
    let path = packs_root(&app)?.join(&slug).join(&rel);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(rd) = fs::read_dir(path) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(m) = e.metadata() {
                total += m.len();
            }
        }
    }
    total
}

#[derive(Serialize)]
struct StorageInfo {
    bytes: u64,
    packs: usize,
}

#[tauri::command]
fn storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    let root = packs_root(&app)?;
    let packs = fs::read_dir(&root)
        .map(|rd| rd.flatten().filter(|e| e.path().join("pack.json").exists()).count())
        .unwrap_or(0);
    Ok(StorageInfo {
        bytes: dir_size(&root),
        packs,
    })
}

#[tauri::command]
fn reveal_packs(app: AppHandle) -> Result<(), String> {
    let root = packs_root(&app)?;
    Command::new("open")
        .arg(&root)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn app_log(app: AppHandle, msg: String) -> Result<(), String> {
    let path = packs_root(&app)?.join("app.log");
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    writeln!(f, "[{ts}] {msg}").map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fetch_pack_index,
            download_pack,
            import_pack,
            get_packs_dir,
            list_imported,
            read_pack_text,
            write_pack_text,
            write_pack_binary,
            delete_pack_file,
            export_video,
            delete_pack,
            storage_info,
            reveal_packs,
            app_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
