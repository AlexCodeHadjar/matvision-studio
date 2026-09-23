//! Optional Blender/Cycles prototype. A child process and its files live only for one job.
use crate::commands::ensure_local_window;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{State, WebviewWindow};
use tempfile::TempDir;

const MAX_SOURCE_BYTES: usize = 64 * 1024 * 1024;
const MAX_OUTPUT_BYTES: u64 = 64 * 1024 * 1024;
const PROBE_SCRIPT: &str = include_str!("../cycles/probe.py");
const RENDER_SCRIPT: &str = include_str!("../cycles/render.py");

#[derive(Default)]
pub struct CyclesState {
    running: Mutex<Option<Running>>,
}

struct Running {
    child: Child,
    directory: TempDir,
    started: Instant,
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for CyclesState {
    fn drop(&mut self) {
        if let Ok(mut running) = self.running.lock() {
            running.take();
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    backend: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    available: bool,
    reason: Option<String>,
    version: Option<String>,
    executable: Option<String>,
    devices: Vec<Device>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    blender_path: String,
    package: Value,
    source_data_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatus {
    stage: String,
    progress: f64,
    detail: String,
    elapsed_ms: u128,
    png_data_url: Option<String>,
}

fn unfinished_status(status: &Value, elapsed_ms: u128) -> JobStatus {
    let reported_stage = status["stage"].as_str().unwrap_or("preparing");
    let final_message = matches!(reported_stage, "done" | "error");
    JobStatus {
        // The Python status file may say "done" just before Blender exits. Only
        // the successful child exit plus a validated PNG make a saveable result.
        stage: if final_message {
            "rendering"
        } else {
            reported_stage
        }
        .into(),
        progress: status["progress"]
            .as_f64()
            .unwrap_or(0.)
            .clamp(0., if final_message { 0.99 } else { 1. }),
        detail: if reported_stage == "done" {
            "Cycles завершает запись PNG…".into()
        } else if reported_stage == "error" {
            "Cycles завершает работу; проверяется ошибка…".into()
        } else {
            status["detail"].as_str().unwrap_or_default().into()
        },
        elapsed_ms,
        png_data_url: None,
    }
}

fn command(executable: &Path) -> Command {
    let mut process = Command::new(executable);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    process
}

fn validate_executable(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || !path.is_file() {
        return Err("Выберите существующий blender.exe на этом компьютере.".into());
    }
    if path
        .file_name()
        .and_then(|v| v.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
        != Some("blender.exe")
    {
        return Err("Ultimate запускает только выбранный blender.exe.".into());
    }
    Ok(())
}

fn probe_impl(path: Option<PathBuf>) -> Capabilities {
    let Some(path) = path.or_else(|| std::env::var_os("MATVISION_BLENDER_PATH").map(PathBuf::from))
    else {
        return Capabilities {
            available: false,
            reason: Some("Blender/Cycles не выбран. Укажите локальный blender.exe.".into()),
            version: None,
            executable: None,
            devices: vec![],
        };
    };
    let failure = |reason: String| Capabilities {
        available: false,
        reason: Some(reason),
        version: None,
        executable: None,
        devices: vec![],
    };
    if let Err(reason) = validate_executable(&path) {
        return failure(reason);
    }
    let directory = match tempfile::Builder::new()
        .prefix("matvision-probe-")
        .tempdir()
    {
        Ok(value) => value,
        Err(_) => return failure("Не удалось создать временный каталог Ultimate.".into()),
    };
    let script = directory.path().join("probe.py");
    if fs::write(&script, PROBE_SCRIPT).is_err() {
        return failure("Не удалось подготовить проверку Cycles.".into());
    }
    let output = command(&path)
        .args([
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
        ])
        .arg(&script)
        .output();
    let Ok(output) = output else {
        return failure("Не удалось запустить Blender.".into());
    };
    if !output.status.success() {
        return failure("Blender запустился, но проверка Cycles завершилась ошибкой.".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let Some(line) = text
        .lines()
        .find_map(|line| line.strip_prefix("MATVISION_CAPABILITIES="))
    else {
        return failure("Cycles не сообщил поддерживаемые устройства.".into());
    };
    let Ok(result) = serde_json::from_str::<Value>(line) else {
        return failure("Cycles вернул неверный список устройств.".into());
    };
    let version = result["version"].as_str().unwrap_or_default();
    if !version.starts_with("4.5.") {
        return failure("Этот прототип проверен только с Blender 4.5 LTS.".into());
    }
    let devices = result["devices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            Some(Device {
                backend: entry["backend"].as_str()?.to_owned(),
                name: entry["name"].as_str()?.to_owned(),
            })
        })
        .collect();
    Capabilities {
        available: true,
        reason: None,
        version: Some(version.to_owned()),
        executable: Some(path.to_string_lossy().into_owned()),
        devices,
    }
}

fn finite_between(value: &Value, min: f64, max: f64) -> bool {
    value
        .as_f64()
        .is_some_and(|number| number.is_finite() && number >= min && number <= max)
}

fn validate_package(package: &Value) -> Result<(), String> {
    if package["schemaVersion"] != 1 {
        return Err("Неподдерживаемая версия временной сцены Ultimate.".into());
    }
    let product = &package["product"];
    for (key, min, max) in [
        ("widthMm", 100., 3000.),
        ("heightMm", 100., 3000.),
        ("thicknessMm", 1., 10.),
        ("cornerRadiusMm", 0., 100.),
    ] {
        if !finite_between(&product[key], min, max) {
            return Err(format!("Неверный параметр изделия Ultimate: {key}."));
        }
    }
    for key in ["positionMm", "targetMm"] {
        if package["camera"][key].as_array().is_none_or(|values| {
            values.len() != 3 || values.iter().any(|v| !finite_between(v, -10_000., 10_000.))
        }) {
            return Err("Неверная камера Ultimate.".into());
        }
    }
    if !finite_between(&package["camera"]["fovDeg"], 10., 100.) {
        return Err("Неверный угол камеры Ultimate.".into());
    }
    if package["printInverse"].as_array().is_none_or(|values| {
        values.len() != 9 || values.iter().any(|v| !finite_between(v, -1000., 1000.))
    }) {
        return Err("Неверное размещение принта Ultimate.".into());
    }
    let render = &package["render"];
    if !finite_between(&render["widthPx"], 128., 3840.)
        || !finite_between(&render["heightPx"], 128., 3840.)
        || !finite_between(&render["samples"], 1., 4096.)
    {
        return Err("Разрешение или число проходов Ultimate вне допустимого диапазона.".into());
    }
    if !["AUTO", "CPU", "OPTIX", "CUDA", "HIP", "ONEAPI"]
        .contains(&render["device"].as_str().unwrap_or_default())
    {
        return Err("Неподдерживаемое устройство Ultimate.".into());
    }
    Ok(())
}

fn source_bytes(data_url: &str) -> Result<(&'static str, Vec<u8>), String> {
    let (prefix, encoded) = data_url
        .split_once(",")
        .ok_or_else(|| "Неверный принт Ultimate.".to_string())?;
    let name = match prefix {
        "data:image/png;base64" => "print.png",
        "data:image/jpeg;base64" => "print.jpg",
        "data:image/webp;base64" => "print.webp",
        _ => return Err("Неподдерживаемый формат принта Ultimate.".into()),
    };
    if encoded.len() > MAX_SOURCE_BYTES * 4 / 3 + 8 {
        return Err("Принт Ultimate слишком велик.".into());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "Повреждены байты принта Ultimate.".to_string())?;
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err("Принт Ultimate слишком велик.".into());
    }
    Ok((name, bytes))
}

#[tauri::command]
pub async fn choose_cycles_executable(window: WebviewWindow) -> Result<Option<String>, String> {
    ensure_local_window(&window)?;
    let picked = rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("Выберите Blender 4.5 LTS · blender.exe")
        .add_filter("Blender", &["exe"])
        .pick_file()
        .await;
    Ok(picked.map(|file| file.path().to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn cycles_probe(
    window: WebviewWindow,
    path: Option<String>,
) -> Result<Capabilities, String> {
    ensure_local_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || probe_impl(path.map(PathBuf::from)))
        .await
        .map_err(|_| "Проверка Cycles прервана.".into())
}

#[tauri::command]
pub async fn cycles_start(
    window: WebviewWindow,
    state: State<'_, Arc<CyclesState>>,
    request: StartRequest,
) -> Result<(), String> {
    ensure_local_window(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&request.blender_path);
        validate_executable(&path)?;
        validate_package(&request.package)?;
        let mut guard = state
            .running
            .lock()
            .map_err(|_| "Ultimate job state failed.")?;
        if guard.is_some() {
            return Err("Ultimate уже выполняет рендер.".into());
        }
        let directory = tempfile::Builder::new()
            .prefix("matvision-cycles-")
            .tempdir()
            .map_err(|_| "Не удалось создать временный каталог Ultimate.")?;
        let mut package = request.package;
        if let Some(source) = request.source_data_url {
            let (name, bytes) = source_bytes(&source)?;
            fs::write(directory.path().join(name), bytes)
                .map_err(|_| "Не удалось подготовить принт Ultimate.")?;
            package["printPath"] = Value::String(name.into());
        } else {
            package["printPath"] = Value::Null;
        }
        let scene_path = directory.path().join("scene.json");
        let script_path = directory.path().join("render.py");
        fs::write(
            &scene_path,
            serde_json::to_vec(&package).map_err(|_| "Неверная сцена Ultimate.")?,
        )
        .map_err(|_| "Не удалось подготовить сцену Ultimate.")?;
        fs::write(&script_path, RENDER_SCRIPT)
            .map_err(|_| "Не удалось подготовить Cycles script.")?;
        let log = File::create(directory.path().join("render.log"))
            .map_err(|_| "Не удалось открыть лог Ultimate.")?;
        let child = command(&path)
            .args([
                "--background",
                "--factory-startup",
                "--python-exit-code",
                "1",
                "--python",
            ])
            .arg(&script_path)
            .arg("--")
            .arg(&scene_path)
            .arg(directory.path().join("result.png"))
            .arg(directory.path().join("status.json"))
            .stdin(Stdio::null())
            .stdout(Stdio::from(
                log.try_clone()
                    .map_err(|_| "Не удалось открыть лог Ultimate.")?,
            ))
            .stderr(Stdio::from(log))
            .spawn()
            .map_err(|_| "Не удалось запустить локальный Cycles.".to_string())?;
        *guard = Some(Running {
            child,
            directory,
            started: Instant::now(),
        });
        Ok(())
    })
    .await
    .map_err(|_| "Ultimate job прерван.".to_string())?
}

#[tauri::command]
pub async fn cycles_poll(
    window: WebviewWindow,
    state: State<'_, Arc<CyclesState>>,
) -> Result<JobStatus, String> {
    ensure_local_window(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = state.running.lock().map_err(|_| "Ultimate job state failed.")?;
        let Some(job) = guard.as_mut() else {
            return Ok(JobStatus { stage: "idle".into(), progress: 0., detail: String::new(), elapsed_ms: 0, png_data_url: None });
        };
        let status: Value = fs::read(job.directory.path().join("status.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(Value::Null);
        let elapsed_ms = job.started.elapsed().as_millis();
        let detail = status["detail"].as_str().unwrap_or_default().to_owned();
        let exit = match job.child.try_wait() {
            Ok(exit) => exit,
            Err(_) => {
                guard.take();
                return Err("Не удалось проверить Cycles process.".into());
            }
        };
        match exit {
            None => Ok(unfinished_status(&status, elapsed_ms)),
            Some(exit) => {
                let result = if exit.success() {
                    (|| -> Result<JobStatus, String> {
                    let output = job.directory.path().join("result.png");
                    let meta = fs::metadata(&output).map_err(|_| "Cycles не создал изображение.")?;
                    if meta.len() > MAX_OUTPUT_BYTES {
                        return Err("Результат Ultimate слишком велик.".into());
                    }
                    let bytes = fs::read(output).map_err(|_| "Не удалось прочитать результат Ultimate.")?;
                    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                        return Err("Cycles создал файл без PNG-подписи.".into());
                    }
                    Ok(JobStatus {
                        stage: "done".into(),
                        progress: 1.,
                        detail,
                        elapsed_ms,
                        png_data_url: Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes))),
                    })
                    })()
                } else {
                    Err("Cycles завершился с ошибкой. Проверьте выбранный Blender и настройки устройства.".into())
                };
                guard.take(); // Kills any surviving child and removes the temporary directory.
                result
            }
        }
    })
    .await
    .map_err(|_| "Ultimate job прерван.".to_string())?
}

#[tauri::command]
pub async fn cycles_cancel(
    window: WebviewWindow,
    state: State<'_, Arc<CyclesState>>,
) -> Result<(), String> {
    ensure_local_window(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state
            .running
            .lock()
            .map_err(|_| "Ultimate job state failed.")?
            .take();
        Ok(())
    })
    .await
    .map_err(|_| "Отмена Ultimate прервана.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_done_before_process_exit_is_not_saveable() {
        let reported = serde_json::json!({"stage": "done", "progress": 1.0, "detail": "PNG ready"});
        let observed = unfinished_status(&reported, 120);
        assert_eq!(observed.stage, "rendering");
        assert_eq!(observed.progress, 0.99);
        assert!(observed.png_data_url.is_none());
        assert!(observed.detail.contains("завершает запись PNG"));
    }

    #[test]
    fn python_error_before_process_exit_keeps_polling() {
        let reported = serde_json::json!({"stage": "error", "progress": 0.5});
        let observed = unfinished_status(&reported, 220);
        assert_eq!(observed.stage, "rendering");
        assert!(observed.png_data_url.is_none());
    }

    #[test]
    fn missing_cycles_is_an_explicit_capability_failure() {
        let result = probe_impl(Some(PathBuf::from("not-a-blender.exe")));
        assert!(!result.available);
        assert!(result.reason.is_some());
    }

    #[test]
    fn package_rejects_unsupported_schema_and_paths() {
        assert!(validate_package(&serde_json::json!({"schemaVersion": 2})).is_err());
        assert!(source_bytes("data:text/plain;base64,SGVsbG8=").is_err());
    }
}
