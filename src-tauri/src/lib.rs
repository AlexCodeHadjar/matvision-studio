//! Native shell. Rendering stays inside the WebGL2 frontend.
mod commands;
mod cycles;
mod files;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    app_version: &'static str,
    platform: &'static str,
    architecture: &'static str,
}

#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        app_version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            commands::open_image,
            commands::open_project,
            commands::save_project,
            commands::save_png,
            cycles::choose_cycles_executable,
            cycles::cycles_probe,
            cycles::cycles_start,
            cycles::cycles_poll,
            cycles::cycles_cancel
        ])
        .manage(std::sync::Arc::new(cycles::CyclesState::default()))
        .setup(|_| {
            #[cfg(debug_assertions)]
            eprintln!("{{\"category\":\"NATIVE\",\"event\":\"shell-ready\"}}");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("MatVision Studio native runtime failed");
}
