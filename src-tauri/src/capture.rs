use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ColorType, ImageEncoder};
use serde::Serialize;
use tauri::command;
use tauri::ipc::Response;
use xcap::{Monitor, Window};

#[derive(Serialize)]
pub struct CaptureWindow {
    id: u32,
    title: String,
}

/// Encode RGBA pixels to PNG using fast compression.
/// Uses `CompressionType::Fast` and `FilterType::Sub` to minimise encode
/// time — the resulting file is slightly larger but the operation is
/// dramatically faster for large screenshots (1080p+).
fn encode_rgba_png(bytes: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    PngEncoder::new_with_quality(&mut output, CompressionType::Fast, FilterType::Sub)
        .write_image(bytes, width, height, ColorType::Rgba8.into())
        .map_err(|error| error.to_string())?;
    Ok(output)
}

/// Capture the primary monitor as a PNG and return raw bytes via
/// `tauri::ipc::Response` (avoids JSON-serialising the entire buffer).
#[command]
pub fn capture_primary_monitor_png() -> Result<Response, String> {
    let monitor = Monitor::all()
        .map_err(|error| error.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "No monitors available".to_string())?;
    let image = monitor.capture_image().map_err(|error| error.to_string())?;
    let png = encode_rgba_png(image.as_raw(), image.width(), image.height())?;
    Ok(Response::new(png))
}

#[command]
pub fn list_capture_windows() -> Result<Vec<CaptureWindow>, String> {
    let windows = Window::all().map_err(|error| error.to_string())?;
    Ok(windows
        .into_iter()
        .filter_map(|window| {
            let title = window.title().ok()?;
            if title.trim().is_empty() {
                return None;
            }
            Some(CaptureWindow {
                id: window.id().ok()? as u32,
                title,
            })
        })
        .collect())
}

/// Capture a specific window as a PNG and return raw bytes.
#[command]
pub fn capture_window_png(id: u32) -> Result<Response, String> {
    let window = Window::all()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|window| window.id().ok().map(|value| value as u32) == Some(id))
        .ok_or_else(|| "Window not found".to_string())?;
    let image = window.capture_image().map_err(|error| error.to_string())?;
    let png = encode_rgba_png(image.as_raw(), image.width(), image.height())?;
    Ok(Response::new(png))
}
