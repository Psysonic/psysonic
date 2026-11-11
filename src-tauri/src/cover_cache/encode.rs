use image::imageops::FilterType;
use image::DynamicImage;
use std::path::Path;

/// Full-res tier: shown whole (lightbox), so it keeps the long-edge fit.
const FULL_RES_TIER: u32 = 2000;

/// Plain cover tier. Display tiers fit the SHORT edge to `tier`: the UI draws
/// covers into square cells with `object-fit: cover`, so a non-square cover
/// needs `tier` px across its short edge. A long-edge fit turned a 450×800
/// playlist cover into a 72×128 `128.webp` that a grid card stretched (#1829).
/// Never upscales.
pub fn resize_tier(img: &DynamicImage, tier: u32) -> DynamicImage {
    if tier >= FULL_RES_TIER {
        return resize_tier_contain(img, tier);
    }
    scale_to(img, tier, img.width().min(img.height()))
}

/// Long-edge fit: for images shown whole rather than cropped into a square
/// (artist fanart/banner surfaces). Never upscales.
pub fn resize_tier_contain(img: &DynamicImage, tier: u32) -> DynamicImage {
    scale_to(img, tier, img.width().max(img.height()))
}

/// Scale so that `edge` (one of the image's edges) becomes `tier`.
fn scale_to(img: &DynamicImage, tier: u32, edge: u32) -> DynamicImage {
    if edge <= tier {
        return img.clone();
    }
    let scale = tier as f32 / edge as f32;
    let nw = (img.width() as f32 * scale).round().max(1.0) as u32;
    let nh = (img.height() as f32 * scale).round().max(1.0) as u32;
    img.resize_exact(nw, nh, FilterType::Triangle)
}

/// Lossy WebP quality (0–100). Larger tiers use lower Q — UI rarely shows 800px raw;
/// dense grids cap at 512px (see `COVER_ART_DENSE_MAX_TIER`).
pub fn webp_quality_for_tier(tier: u32) -> f32 {
    match tier {
        2000 => 82.0,
        800 => 70.0,
        512 => 73.0,
        256 => 76.0,
        128 => 78.0,
        _ => 74.0,
    }
}

pub fn encode_webp(img: &DynamicImage, tier: u32) -> Result<Vec<u8>, String> {
    let rgba = img.to_rgba8();
    let enc = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height());
    Ok(enc.encode(webp_quality_for_tier(tier)).to_vec())
}

/// Write a plain cover tier ([`resize_tier`]).
pub fn write_webp_tier(img: &DynamicImage, tier: u32, path: &Path) -> Result<(), String> {
    write_resized(&resize_tier(img, tier), tier, path)
}

/// Write a tier of an image shown whole ([`resize_tier_contain`]).
pub fn write_webp_tier_contain(img: &DynamicImage, tier: u32, path: &Path) -> Result<(), String> {
    write_resized(&resize_tier_contain(img, tier), tier, path)
}

fn write_resized(resized: &DynamicImage, tier: u32, path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = encode_webp(resized, tier)?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbaImage;

    fn canvas(w: u32, h: u32) -> DynamicImage {
        DynamicImage::ImageRgba8(RgbaImage::new(w, h))
    }

    fn dims(img: &DynamicImage) -> (u32, u32) {
        (img.width(), img.height())
    }

    #[test]
    fn resize_tier_contain_fits_the_long_edge() {
        assert_eq!(
            dims(&resize_tier_contain(&canvas(800, 600), 128)),
            (128, 96)
        );
    }

    #[test]
    fn display_tier_fits_the_short_edge_of_a_portrait_cover() {
        // A 450×800 playlist cover used to become 72×128 / 144×256.
        assert_eq!(dims(&resize_tier(&canvas(450, 800), 128)), (128, 228));
        assert_eq!(dims(&resize_tier(&canvas(450, 800), 256)), (256, 455));
    }

    #[test]
    fn display_tier_fits_the_short_edge_of_a_landscape_cover() {
        assert_eq!(dims(&resize_tier(&canvas(800, 450), 128)), (228, 128));
    }

    #[test]
    fn display_tier_scales_a_square_cover_as_before() {
        assert_eq!(dims(&resize_tier(&canvas(800, 800), 256)), (256, 256));
    }

    #[test]
    fn display_tier_never_upscales() {
        // Short edge already within the tier: the cover is kept as is.
        assert_eq!(dims(&resize_tier(&canvas(450, 800), 512)), (450, 800));
        assert_eq!(dims(&resize_tier(&canvas(100, 60), 128)), (100, 60));
    }

    #[test]
    fn full_res_tier_keeps_the_long_edge_fit() {
        assert_eq!(dims(&resize_tier(&canvas(3000, 1500), 2000)), (2000, 1000));
    }

    #[test]
    fn webp_quality_decreases_with_tier_size() {
        assert!(webp_quality_for_tier(800) < webp_quality_for_tier(512));
        assert!(webp_quality_for_tier(512) < webp_quality_for_tier(128));
        assert!(webp_quality_for_tier(800) < webp_quality_for_tier(2000));
    }

    #[test]
    fn webp_encode_800_smaller_than_old_lossless_upper_bound() {
        let img = DynamicImage::ImageRgba8(RgbaImage::new(800, 800));
        let bytes = encode_webp(&img, 800).expect("webp");
        assert!(
            bytes.len() < 250_000,
            "expected lossy 800 webp well under legacy JPEG cap, got {} bytes",
            bytes.len()
        );
    }
}
