use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::imageops::overlay;
use image::{ColorType, ImageEncoder, RgbaImage};
use serde::Serialize;
use tauri::command;
use tauri::ipc::Response;
use xcap::{Monitor, Window};

#[derive(Serialize)]
pub struct CaptureWindow {
    id: u32,
    title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VirtualDesktopBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MonitorSurface {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug)]
struct CapturedMonitorSurface {
    surface: MonitorSurface,
    image: RgbaImage,
}

fn encode_rgba_png(bytes: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    PngEncoder::new_with_quality(&mut output, CompressionType::Fast, FilterType::Sub)
        .write_image(bytes, width, height, ColorType::Rgba8.into())
        .map_err(|error| error.to_string())?;
    Ok(output)
}

fn encode_image_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    encode_rgba_png(image.as_raw(), image.width(), image.height())
}

fn load_monitor_surfaces(monitors: Vec<Monitor>) -> Result<Vec<MonitorSurface>, String> {
    monitors
        .into_iter()
        .map(|monitor| {
            Ok(MonitorSurface {
                x: monitor.x().map_err(|error| error.to_string())?,
                y: monitor.y().map_err(|error| error.to_string())?,
                width: monitor.width().map_err(|error| error.to_string())?,
                height: monitor.height().map_err(|error| error.to_string())?,
            })
        })
        .collect()
}

fn compute_virtual_desktop_bounds(
    surfaces: &[MonitorSurface],
) -> Result<VirtualDesktopBounds, String> {
    let first_surface = surfaces
        .first()
        .ok_or_else(|| "No monitors available".to_string())?;
    let mut min_x = first_surface.x;
    let mut min_y = first_surface.y;
    let mut max_x = first_surface.x + first_surface.width as i32;
    let mut max_y = first_surface.y + first_surface.height as i32;

    for surface in surfaces.iter().skip(1) {
        min_x = min_x.min(surface.x);
        min_y = min_y.min(surface.y);
        max_x = max_x.max(surface.x + surface.width as i32);
        max_y = max_y.max(surface.y + surface.height as i32);
    }

    Ok(VirtualDesktopBounds {
        x: min_x,
        y: min_y,
        width: (max_x - min_x) as u32,
        height: (max_y - min_y) as u32,
    })
}

fn capture_virtual_desktop_image() -> Result<(RgbaImage, VirtualDesktopBounds), String> {
    let monitors = Monitor::all().map_err(|error| error.to_string())?;
    let surfaces = load_monitor_surfaces(monitors.clone())?;
    let bounds = compute_virtual_desktop_bounds(&surfaces)?;

    let captured_surfaces = monitors
        .into_iter()
        .zip(surfaces.into_iter())
        .map(|(monitor, surface)| {
            Ok(CapturedMonitorSurface {
                image: monitor.capture_image().map_err(|error| error.to_string())?,
                surface,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let mut image = RgbaImage::new(bounds.width, bounds.height);
    for captured_surface in captured_surfaces {
        overlay(
            &mut image,
            &captured_surface.image,
            (captured_surface.surface.x - bounds.x) as i64,
            (captured_surface.surface.y - bounds.y) as i64,
        );
    }

    Ok((image, bounds))
}

#[command]
pub fn get_virtual_desktop_bounds() -> Result<VirtualDesktopBounds, String> {
    let monitors = Monitor::all().map_err(|error| error.to_string())?;
    let surfaces = load_monitor_surfaces(monitors)?;
    compute_virtual_desktop_bounds(&surfaces)
}

#[command]
pub fn capture_virtual_desktop_png() -> Result<Response, String> {
    let (image, _) = capture_virtual_desktop_image()?;
    Ok(Response::new(encode_image_png(&image)?))
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

#[command]
pub fn capture_window_png(id: u32) -> Result<Response, String> {
    let window = Window::all()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|window| window.id().ok().map(|value| value as u32) == Some(id))
        .ok_or_else(|| "Window not found".to_string())?;
    let image = window.capture_image().map_err(|error| error.to_string())?;
    Ok(Response::new(encode_image_png(&image)?))
}

#[cfg(test)]
mod tests {
    use image::{Rgba, RgbaImage};

    use super::*;

    #[test]
    fn computes_virtual_desktop_bounds_with_negative_origins() {
        let bounds = compute_virtual_desktop_bounds(&[
            MonitorSurface {
                x: -1280,
                y: 0,
                width: 1280,
                height: 1024,
            },
            MonitorSurface {
                x: 0,
                y: -120,
                width: 2560,
                height: 1440,
            },
        ])
        .unwrap();

        assert_eq!(
            bounds,
            VirtualDesktopBounds {
                x: -1280,
                y: -120,
                width: 3840,
                height: 1560,
            }
        );
    }

    #[test]
    fn overlays_monitor_images_into_virtual_desktop_space() {
        let bounds = VirtualDesktopBounds {
            x: -1,
            y: 0,
            width: 3,
            height: 1,
        };
        let mut image = RgbaImage::new(bounds.width, bounds.height);
        let mut left = RgbaImage::new(1, 1);
        let mut right = RgbaImage::new(2, 1);
        left.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
        right.put_pixel(0, 0, Rgba([0, 255, 0, 255]));
        right.put_pixel(1, 0, Rgba([0, 0, 255, 255]));

        overlay(&mut image, &left, 0, 0);
        overlay(&mut image, &right, 1, 0);

        assert_eq!(image.get_pixel(0, 0), &Rgba([255, 0, 0, 255]));
        assert_eq!(image.get_pixel(1, 0), &Rgba([0, 255, 0, 255]));
        assert_eq!(image.get_pixel(2, 0), &Rgba([0, 0, 255, 255]));
    }
}
