use std::fs;
use std::io::Write as _;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const R2_BASE: &str = "https://pub-d3643445511f4a59b7c1923785cafa51.r2.dev/mods/dub";
const INDEX_URL: &str = "https://choicervoicer.com/pack-index.json";
const DEEPL_FREE_URL: &str = "https://api-free.deepl.com/v2/translate";
const DEEPL_PRO_URL: &str = "https://api.deepl.com/v2/translate";
const DEEPL_BATCH: usize = 50;

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
    done: f64,
    total: f64,
}

#[derive(Deserialize)]
struct DeeplResponse {
    translations: Vec<DeeplTranslation>,
}

#[derive(Deserialize)]
struct DeeplTranslation {
    text: String,
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

fn short_name(file: &Path) -> String {
    file.file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| file.display().to_string())
}

fn write_log(app: &AppHandle, msg: &str) {
    let Ok(root) = packs_root(app) else { return };
    let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join("app.log"))
    else {
        return;
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = writeln!(f, "[{ts}] {msg}");
}

fn readable(app: &AppHandle, detail: String, message: &str) -> String {
    write_log(app, &detail);
    message.to_string()
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

fn translations_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("translations");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn safe_slug(slug: &str) -> Result<(), String> {
    if slug.is_empty()
        || !slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("Недопустимое имя пака: {slug}"));
    }
    Ok(())
}

fn safe_rel(rel: &str) -> Result<(), String> {
    if rel.split('/').any(|p| p == ".." || p.is_empty()) {
        return Err(format!("Недопустимый путь: {rel}"));
    }
    Ok(())
}

fn safe_dub(dub: &str) -> Result<(), String> {
    if dub.is_empty()
        || !dub
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("Недопустимое имя дубля: {dub}"));
    }
    Ok(())
}

fn dub_dir(pack_dir: &Path, dub: &str) -> PathBuf {
    pack_dir.join("dubs").join(dub)
}

fn write_dub_info(dir: &Path, dub: &str, kind: &str) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let info = serde_json::json!({
        "id": dub,
        "kind": kind,
        "createdAt": now,
        "updatedAt": now,
        "participants": [],
        "roles": {}
    });
    fs::write(dir.join("dub.json"), info.to_string()).map_err(|e| e.to_string())
}

fn migrate_pack_to_dubs(pack_dir: &Path) -> Result<bool, String> {
    let solo = dub_dir(pack_dir, "solo");
    if solo.join("takes.json").exists() || solo.join("takes").exists() {
        return Ok(false);
    }
    let legacy_takes = pack_dir.join("takes.json");
    let legacy_dir = pack_dir.join("takes");
    if !legacy_takes.exists() && !legacy_dir.exists() {
        return Ok(false);
    }
    fs::create_dir_all(&solo).map_err(|e| e.to_string())?;
    for name in ["takes.json", "takes", "mix.wav", "mix.json"] {
        let from = pack_dir.join(name);
        if from.exists() {
            fs::rename(&from, solo.join(name)).map_err(|e| e.to_string())?;
        }
    }
    if !solo.join("dub.json").exists() {
        write_dub_info(&solo, "solo", "solo")?;
    }
    Ok(true)
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
    Err("Не найден ffmpeg. Установите его командой: brew install ffmpeg".into())
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
    Err("Не найден ffprobe. Установите ffmpeg командой: brew install ffmpeg".into())
}

fn clock(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    format!("{}:{:02}", total / 60, total % 60)
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
    if let Ok(d) = s.trim().parse::<f64>() {
        return Ok(d);
    }
    count_duration(file).ok_or_else(|| format!("Не удалось определить длительность файла «{}»", short_name(file)))
}

fn count_duration(file: &Path) -> Option<f64> {
    let out = Command::new(ffprobe_path().ok()?)
        .args([
            "-v",
            "error",
            "-count_packets",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=nb_read_packets,r_frame_rate",
            "-of",
            "default=noprint_wrappers=1",
        ])
        .arg(file)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut packets = None;
    let mut fps = None;
    for line in text.lines() {
        let (key, value) = line.split_once('=')?;
        match key.trim() {
            "nb_read_packets" => packets = value.trim().parse::<f64>().ok(),
            "r_frame_rate" => {
                let (num, den) = value.trim().split_once('/')?;
                let num = num.parse::<f64>().ok()?;
                let den = den.parse::<f64>().ok()?;
                if den > 0.0 && num > 0.0 {
                    fps = Some(num / den);
                }
            }
            _ => {}
        }
    }
    match (packets, fps) {
        (Some(p), Some(f)) if p > 0.0 => Some(p / f),
        _ => None,
    }
}

fn run_ffmpeg_watched(
    args: &[&str],
    input: &Path,
    output: &Path,
    duration: f64,
    mut on_progress: impl FnMut(f64),
) -> Result<(), String> {
    let mut child = Command::new(ffmpeg_path()?)
        .arg("-y")
        .args(["-progress", "pipe:1", "-nostats", "-loglevel", "error"])
        .arg("-i")
        .arg(input)
        .args(args)
        .arg(output)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Some(us) = line.strip_prefix("out_time_us=") else {
                continue;
            };
            let Ok(us) = us.trim().parse::<f64>() else {
                continue;
            };
            if duration > 0.0 {
                on_progress((us / 1_000_000.0 / duration).clamp(0.0, 1.0));
            }
        }
    }

    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "ffmpeg упал на {}: {}",
            short_name(input),
            String::from_utf8_lossy(&out.stderr)
                .lines()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .join(" | ")
        ));
    }
    Ok(())
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
            short_name(input),
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

async fn download_index() -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(INDEX_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Сервер ответил ошибкой {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_pack_index(app: AppHandle) -> Result<String, String> {
    let cache = packs_root(&app)?.join("pack-index.json");
    if let Ok(cached) = fs::read_to_string(&cache) {
        let known = cached.clone();
        tauri::async_runtime::spawn(async move {
            let Ok(fresh) = download_index().await else { return };
            if fresh == known {
                return;
            }
            let _ = fs::write(&cache, &fresh);
            let _ = app.emit("index-updated", fresh);
        });
        return Ok(cached);
    }
    let text = download_index()
        .await
        .map_err(|_| "Каталог недоступен. Проверьте подключение к интернету".to_string())?;
    let _ = fs::write(&cache, &text);
    Ok(text)
}

fn deepl_url(key: &str) -> &'static str {
    if key.trim().ends_with(":fx") {
        DEEPL_FREE_URL
    } else {
        DEEPL_PRO_URL
    }
}

fn deepl_error(status: u16) -> &'static str {
    match status {
        401 | 403 => "Ключ DeepL не принят. Проверьте его в настройках",
        429 => "DeepL просит подождать — слишком много запросов подряд. Повторите через минуту",
        456 => "Исчерпан месячный лимит переводов DeepL",
        _ => "Не удалось перевести реплики",
    }
}

#[tauri::command]
async fn translate_lines(
    app: AppHandle,
    key: String,
    texts: Vec<String>,
    context: String,
) -> Result<Vec<String>, String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("Не задан ключ DeepL — добавьте его в настройках".into());
    }
    let url = deepl_url(&key);
    let client = reqwest::Client::new();
    let mut out: Vec<String> = Vec::with_capacity(texts.len());

    for chunk in texts.chunks(DEEPL_BATCH) {
        let mut body = serde_json::json!({
            "text": chunk,
            "target_lang": "RU",
        });
        if !context.is_empty() {
            body["context"] = serde_json::Value::String(context.clone());
        }
        let resp = client
            .post(url)
            .header("Authorization", format!("DeepL-Auth-Key {key}"))
            .header("User-Agent", "Dubl/0.1.0")
            .json(&body)
            .send()
            .await
            .map_err(|e| readable(&app, e.to_string(), "Не удалось связаться с DeepL"))?;

        let status = resp.status();
        if !status.is_success() {
            let detail = format!(
                "DeepL ответил {}: {}",
                status,
                resp.text().await.unwrap_or_default()
            );
            return Err(readable(&app, detail, deepl_error(status.as_u16())));
        }

        let parsed: DeeplResponse = resp
            .json()
            .await
            .map_err(|e| readable(&app, e.to_string(), "DeepL вернул неожиданный ответ"))?;
        out.extend(parsed.translations.into_iter().map(|t| t.text));
    }

    if out.len() != texts.len() {
        let detail = format!("DeepL вернул {} переводов на {} реплик", out.len(), texts.len());
        return Err(readable(&app, detail, "DeepL перевёл не все реплики"));
    }
    Ok(out)
}

#[tauri::command]
async fn download_pack(app: AppHandle, slug: String) -> Result<(), String> {
    safe_slug(&slug)?;
    let url = format!("{R2_BASE}/{slug}/download/{slug}.zip");
    let zip_path = packs_root(&app)?.join(format!("{slug}.zip"));

    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Сервер ответил ошибкой {}", resp.status()));
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
        .map_err(|_| "Файлы пака не найдены. Скачайте пак заново".to_string())?
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
        .ok_or("В паке нет видео".to_string())?;

    let pack_info = find("_pack_info.ini")
        .and_then(|p| fs::read_to_string(p).ok())
        .unwrap_or_default();

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

    let weight_of = |p: &Path| fs::metadata(p).map(|m| m.len() as f64).unwrap_or(0.0).max(1.0);
    let video_weight = weight_of(&video_src);
    let backing_weight = backing_src.as_ref().map(|b| weight_of(b)).unwrap_or(0.0);
    let line_weights: Vec<f64> = line_audio.iter().map(|p| weight_of(p)).collect();
    let total_weight = video_weight + backing_weight + line_weights.iter().sum::<f64>();

    let mut done_weight = 0.0f64;
    let mut last_emit = std::time::Instant::now();
    let emit_progress = |step: &str, done: f64| {
        let _ = app.emit(
            "import-progress",
            ImportProgress {
                slug: slug.clone(),
                step: step.to_string(),
                done,
                total: total_weight,
            },
        );
    };

    let source_duration = probe_duration(&video_src).unwrap_or(0.0);
    emit_progress(&format!("Видео · {}", clock(source_duration)), 0.0);
    let video_out = pack_dir.join("video.mp4");
    let needs_transcode = video_src
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase() != "mp4")
        .unwrap_or(true);
    if needs_transcode {
        let watched = run_ffmpeg_watched(
            &[
                "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
            ],
            &video_src,
            &video_out,
            source_duration,
            |frac| {
                if last_emit.elapsed().as_millis() < 120 {
                    return;
                }
                last_emit = std::time::Instant::now();
                emit_progress(
                    &format!(
                        "Видео · {} из {}",
                        clock(source_duration * frac),
                        clock(source_duration)
                    ),
                    video_weight * frac,
                );
            },
        );
        watched.map_err(|e| readable(&app, e, "Не удалось обработать видео"))?;
    } else {
        fs::copy(&video_src, &video_out).map_err(|e| e.to_string())?;
    }
    let video_duration = probe_duration(&video_out)?;
    done_weight += video_weight;
    emit_progress("Видео готово", done_weight);

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
        run_ffmpeg(&["-vn", "-c:a", "aac", "-b:a", "192k"], b, &out)
            .map_err(|e| readable(&app, e, "Не удалось обработать фонограмму"))?;
        done_weight += backing_weight;
        emit_progress("Фонограмма", done_weight);
        Some("backing.m4a".to_string())
    } else {
        None
    };

    let lines_dir = pack_dir.join("lines");
    fs::create_dir_all(&lines_dir).map_err(|e| e.to_string())?;
    let mut lines: Vec<LineEntry> = vec![];
    for (i, audio) in line_audio.iter().enumerate() {
        let base = audio.file_stem().unwrap().to_string_lossy().to_string();
        let out = lines_dir.join(format!("{base}.m4a"));
        run_ffmpeg(&["-vn", "-c:a", "aac", "-b:a", "160k"], audio, &out)
            .map_err(|e| readable(&app, e, "Не удалось обработать запись реплики"))?;
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

        done_weight += line_weights[i];
        emit_progress(
            &format!("Реплика {} из {}", i + 1, line_audio.len()),
            done_weight,
        );
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
async fn export_video(app: AppHandle, slug: String, dub: String, title: String) -> Result<String, String> {
    safe_slug(&slug)?;
    safe_dub(&dub)?;
    let pack_dir = packs_root(&app)?.join(&slug);
    let video = pack_dir.join("video.mp4");
    let mix = dub_dir(&pack_dir, &dub).join("mix.wav");
    if !mix.exists() {
        return Err("Сначала сведите дубляж".into());
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
            let detail = format!(
                "ffmpeg не собрал файл: {}",
                String::from_utf8_lossy(&res.stderr).lines().rev().take(3).collect::<Vec<_>>().join(" | ")
            );
            return Err(readable(&app, detail, "Не удалось сохранить видео"));
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
fn read_translation(app: AppHandle, slug: String) -> Result<String, String> {
    safe_slug(&slug)?;
    fs::read_to_string(translations_root(&app)?.join(format!("{slug}.json"))).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_translation(app: AppHandle, slug: String, content: String) -> Result<(), String> {
    safe_slug(&slug)?;
    fs::write(translations_root(&app)?.join(format!("{slug}.json")), content).map_err(|e| e.to_string())
}

#[tauri::command]
fn migrate_dubs(app: AppHandle, slug: String) -> Result<bool, String> {
    safe_slug(&slug)?;
    migrate_pack_to_dubs(&packs_root(&app)?.join(&slug))
}

#[tauri::command]
fn list_dubs(app: AppHandle, slug: String) -> Result<Vec<String>, String> {
    safe_slug(&slug)?;
    let root = packs_root(&app)?.join(&slug).join("dubs");
    let mut out = vec![];
    if let Ok(rd) = fs::read_dir(&root) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() && p.join("dub.json").exists() {
                out.push(e.file_name().to_string_lossy().to_string());
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn delete_dub(app: AppHandle, slug: String, dub: String) -> Result<(), String> {
    safe_slug(&slug)?;
    safe_dub(&dub)?;
    let dir = dub_dir(&packs_root(&app)?.join(&slug), &dub);
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
            .ok_or_else(|| format!("Не хватает данных для записи файла: {name}"))
    };
    let slug = header("slug")?;
    let rel = header("rel")?;
    safe_slug(&slug)?;
    safe_rel(&rel)?;
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("Ожидались бинарные данные".into());
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
    write_log(&app, &msg);
    Ok(())
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
            app_log,
            translate_lines,
            read_translation,
            write_translation,
            migrate_dubs,
            list_dubs,
            delete_dub
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_video(path: &Path, seconds: u32) {
        let status = Command::new(ffmpeg_path().unwrap())
            .arg("-y")
            .args(["-f", "lavfi", "-i"])
            .arg(format!("testsrc=duration={seconds}:size=1280x720:rate=30"))
            .args(["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"])
            .arg(path)
            .output()
            .unwrap();
        assert!(status.status.success(), "не удалось собрать тестовое видео");
    }

    fn fresh_pack_dir(name: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("dubl-dubs-{name}-{stamp}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn legacy_pack(name: &str) -> PathBuf {
        let dir = fresh_pack_dir(name);
        fs::create_dir_all(dir.join("takes")).unwrap();
        fs::write(dir.join("takes.json"), r#"{"01_x":{"file":"takes/01_x.wav"}}"#).unwrap();
        fs::write(dir.join("takes/01_x.wav"), b"wav").unwrap();
        fs::write(dir.join("mix.wav"), b"mix").unwrap();
        dir
    }

    #[test]
    fn migration_moves_legacy_recordings_into_solo_dub() {
        let pack = legacy_pack("moves");

        let migrated = migrate_pack_to_dubs(&pack).unwrap();

        assert!(migrated);
        assert_eq!(
            fs::read_to_string(pack.join("dubs/solo/takes.json")).unwrap(),
            r#"{"01_x":{"file":"takes/01_x.wav"}}"#
        );
        assert_eq!(fs::read(pack.join("dubs/solo/takes/01_x.wav")).unwrap(), b"wav");
        assert_eq!(fs::read(pack.join("dubs/solo/mix.wav")).unwrap(), b"mix");
        assert!(!pack.join("takes.json").exists());
        assert!(!pack.join("takes").exists());
    }

    #[test]
    fn migration_describes_moved_recordings_as_solo_dub() {
        let pack = legacy_pack("describes");

        migrate_pack_to_dubs(&pack).unwrap();

        let info: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(pack.join("dubs/solo/dub.json")).unwrap()).unwrap();
        assert_eq!(info["id"], "solo");
        assert_eq!(info["kind"], "solo");
        assert_eq!(info["participants"], serde_json::json!([]));
    }

    #[test]
    fn migration_leaves_pack_without_recordings_alone() {
        let pack = fresh_pack_dir("empty");

        let migrated = migrate_pack_to_dubs(&pack).unwrap();

        assert!(!migrated);
        assert!(!pack.join("dubs").exists());
    }

    #[test]
    fn migration_does_not_touch_pack_that_already_has_solo_dub() {
        let pack = legacy_pack("already");
        fs::create_dir_all(pack.join("dubs/solo")).unwrap();
        fs::write(pack.join("dubs/solo/takes.json"), r#"{"kept":true}"#).unwrap();

        let migrated = migrate_pack_to_dubs(&pack).unwrap();

        assert!(!migrated);
        assert_eq!(
            fs::read_to_string(pack.join("dubs/solo/takes.json")).unwrap(),
            r#"{"kept":true}"#
        );
        assert!(pack.join("takes.json").exists());
    }

    #[test]
    fn free_key_goes_to_free_host() {
        assert_eq!(deepl_url("abc-123:fx"), DEEPL_FREE_URL);
    }

    #[test]
    fn pro_key_goes_to_pro_host() {
        assert_eq!(deepl_url("abc-123"), DEEPL_PRO_URL);
    }

    #[test]
    fn key_with_spaces_still_detects_free_plan() {
        assert_eq!(deepl_url("  abc-123:fx  "), DEEPL_FREE_URL);
    }

    #[test]
    fn deepl_errors_are_explained() {
        assert_eq!(deepl_error(403), "Ключ DeepL не принят. Проверьте его в настройках");
        assert_eq!(deepl_error(456), "Исчерпан месячный лимит переводов DeepL");
        assert_eq!(deepl_error(500), "Не удалось перевести реплики");
    }

    #[test]
    fn clock_formats_minutes_and_seconds() {
        assert_eq!(clock(81.0), "1:21");
    }

    #[test]
    fn clock_pads_seconds_below_ten() {
        assert_eq!(clock(65.0), "1:05");
    }

    #[test]
    fn clock_clamps_negative_input() {
        assert_eq!(clock(-3.0), "0:00");
    }

    #[test]
    fn watched_transcode_reports_growing_progress() {
        let dir = std::env::temp_dir().join("dubl-progress-test");
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("in.mp4");
        let output = dir.join("out.mp4");
        make_test_video(&input, 20);

        let mut seen: Vec<f64> = vec![];
        run_ffmpeg_watched(
            &["-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p"],
            &input,
            &output,
            probe_duration(&input).unwrap(),
            |frac| seen.push(frac),
        )
        .unwrap();

        assert!(seen.len() > 1, "прогресс пришёл лишь однажды: {seen:?}");
        assert!(seen.windows(2).all(|w| w[1] >= w[0]), "прогресс убывал: {seen:?}");
        assert!(seen.iter().all(|f| (0.0..=1.0).contains(f)), "доля вне диапазона: {seen:?}");
        assert!(*seen.last().unwrap() > 0.9, "прогресс не дошёл до конца: {seen:?}");
    }

    fn make_raw_h264(path: &Path, seconds: u32) {
        let status = Command::new(ffmpeg_path().unwrap())
            .arg("-y")
            .args(["-f", "lavfi", "-i"])
            .arg(format!("testsrc=duration={seconds}:size=320x240:rate=30"))
            .args(["-c:v", "libx264", "-preset", "ultrafast", "-f", "h264"])
            .arg(path)
            .output()
            .unwrap();
        assert!(status.status.success(), "не удалось собрать сырой поток h264");
    }

    fn make_y4m(path: &Path, seconds: u32) {
        let status = Command::new(ffmpeg_path().unwrap())
            .arg("-y")
            .args(["-f", "lavfi", "-i"])
            .arg(format!("testsrc=duration={seconds}:size=160x120:rate=30"))
            .args(["-pix_fmt", "yuv420p", "-f", "yuv4mpegpipe"])
            .arg(path)
            .output()
            .unwrap();
        assert!(status.status.success(), "не удалось собрать y4m");
    }

    #[test]
    fn count_duration_measures_by_packets_and_frame_rate() {
        let dir = std::env::temp_dir().join("dubl-duration-test");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("six-seconds.y4m");
        make_y4m(&file, 6);

        let measured = count_duration(&file).unwrap();

        assert!((measured - 6.0).abs() < 0.05, "намерили {measured} вместо 6 секунд");
    }

    #[test]
    fn probe_duration_falls_back_when_header_is_silent() {
        let dir = std::env::temp_dir().join("dubl-duration-test");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("headless.h264");
        make_raw_h264(&file, 6);

        let measured = probe_duration(&file).unwrap();

        assert!(measured > 0.0, "фолбэк вернул {measured}");
    }

    #[test]
    fn probe_duration_reports_missing_file() {
        let missing = std::env::temp_dir().join("dubl-duration-test/нет-такого.mp4");

        assert!(probe_duration(&missing).is_err());
    }

    #[test]
    fn watched_transcode_fails_on_missing_input() {
        let missing = std::env::temp_dir().join("dubl-progress-test/нет-такого.mp4");
        let output = std::env::temp_dir().join("dubl-progress-test/never.mp4");

        let result = run_ffmpeg_watched(&["-c:v", "libx264"], &missing, &output, 1.0, |_| {});

        assert!(result.is_err());
    }
}
