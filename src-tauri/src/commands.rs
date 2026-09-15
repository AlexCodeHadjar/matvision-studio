use crate::files::{self, PrintSource};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::PathBuf;
use tauri::{
    ipc::{InvokeBody, Request},
    WebviewWindow,
};

fn allowed_origin(url: &tauri::Url, debug: bool) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let local_app = url.port().is_none()
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (matches!(url.scheme(), "http" | "https")
                && url.host_str() == Some("tauri.localhost")));
    let development = debug
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(1420);
    local_app || development
}

fn ensure_local_window(window: &WebviewWindow) -> Result<(), String> {
    let url = window
        .url()
        .map_err(|_| "Could not verify the application window.".to_string())?;
    if window.label() != "main" || !allowed_origin(&url, cfg!(debug_assertions)) {
        return Err(
            "File commands are available only in the local MatVision Studio window.".into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn open_image(
    window: WebviewWindow,
    path: Option<String>,
) -> Result<Option<PrintSource>, String> {
    ensure_local_window(&window)?;
    let path = match path {
        Some(path) => PathBuf::from(path),
        None => match rfd::AsyncFileDialog::new()
            .set_parent(&window)
            .set_title("Open print image")
            .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
            .pick_file()
            .await
        {
            Some(file) => file.path().to_owned(),
            None => return Ok(None),
        },
    };
    tauri::async_runtime::spawn_blocking(move || files::open_image(&path))
        .await
        .map_err(|_| "The image worker could not finish.".to_string())?
        .map(Some)
}

#[tauri::command]
pub async fn open_project(
    window: WebviewWindow,
    path: Option<String>,
) -> Result<Option<String>, String> {
    ensure_local_window(&window)?;
    let path = match path {
        Some(path) => PathBuf::from(path),
        None => match rfd::AsyncFileDialog::new()
            .set_parent(&window)
            .set_title("Open MatVision project")
            .add_filter("MatVision project", &["matvision"])
            .pick_file()
            .await
        {
            Some(file) => file.path().to_owned(),
            None => return Ok(None),
        },
    };
    tauri::async_runtime::spawn_blocking(move || files::open_project(&path))
        .await
        .map_err(|_| "The project worker could not finish.".to_string())?
        .map(Some)
}

#[tauri::command]
pub async fn save_project(
    window: WebviewWindow,
    contents: String,
    path: Option<String>,
) -> Result<Option<String>, String> {
    ensure_local_window(&window)?;
    let path = match path {
        Some(path) => PathBuf::from(path),
        None => match rfd::AsyncFileDialog::new()
            .set_parent(&window)
            .set_title("Save MatVision project")
            .add_filter("MatVision project", &["matvision"])
            .set_file_name("Untitled.matvision")
            .save_file()
            .await
        {
            Some(file) => file.path().to_owned(),
            None => return Ok(None),
        },
    };
    tauri::async_runtime::spawn_blocking(move || files::save_project(&contents, &path))
        .await
        .map_err(|_| "The project save worker could not finish.".to_string())?
        .map(Some)
}

#[tauri::command]
pub async fn save_png(
    window: WebviewWindow,
    request: Request<'_>,
) -> Result<Option<String>, String> {
    ensure_local_window(&window)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("PNG export expects binary bytes.".into());
    };
    if bytes.len() as u64 > files::MAX_PNG_BYTES {
        return Err("PNG export exceeds 256 MiB.".into());
    }
    let bytes = bytes.clone();
    let path = request
        .headers()
        .get("x-matvision-path")
        .map(|value| {
            value
                .to_str()
                .map_err(|_| "The export path header is invalid.".to_string())
        })
        .transpose()?
        .unwrap_or_default();
    let path = if path.is_empty() {
        match rfd::AsyncFileDialog::new()
            .set_parent(&window)
            .set_title("Export preview PNG")
            .add_filter("PNG image", &["png"])
            .set_file_name("MatVision-preview.png")
            .save_file()
            .await
        {
            Some(file) => file.path().to_owned(),
            None => return Ok(None),
        }
    } else {
        let decoded = STANDARD
            .decode(path)
            .map_err(|_| "The export path encoding is invalid.".to_string())?;
        PathBuf::from(
            String::from_utf8(decoded).map_err(|_| "The export path is not UTF-8.".to_string())?,
        )
    };
    tauri::async_runtime::spawn_blocking(move || files::save_png(&bytes, &path))
        .await
        .map_err(|_| "The PNG export worker could not finish.".to_string())?
        .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_commands_accept_only_packaged_origin_or_debug_dev_server() {
        for url in [
            "http://tauri.localhost/",
            "https://tauri.localhost/",
            "tauri://localhost/index.html",
        ] {
            assert!(allowed_origin(&tauri::Url::parse(url).unwrap(), false));
        }
        for url in [
            "https://example.com/",
            "http://localhost:8080/",
            "http://tauri.localhost:9999/",
            "file:///tmp/page.html",
            "https://user@tauri.localhost/",
        ] {
            assert!(!allowed_origin(&tauri::Url::parse(url).unwrap(), true));
        }
        let dev = tauri::Url::parse("http://localhost:1420/").unwrap();
        assert!(allowed_origin(&dev, true));
        assert!(!allowed_origin(&dev, false));
    }
}
