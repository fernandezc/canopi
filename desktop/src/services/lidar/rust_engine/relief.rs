//! Shaded relief (canopi-2add): IGN-style grey hillshade of an elevation band.
//!
//! Horn's 3×3 gradient with gdaldem's hillshade formula and defaults (light
//! from azimuth 315°, altitude 45°, z = 1), so `gdaldem hillshade
//! -compute_edges` is the oracle (`comparison::e2e_relief_matches_gdaldem_horn`).
//! GeoLibre's `run_shade_core` is a 5×5 Florinsky stencil; Horn is chosen to
//! match IGN's LiDAR HD relief layers and the oracle (ADR 0002 reason).
//!
//! A cell is shaded on its own grid with its row's east-west and north-south
//! ground sizes, so a degree or Web Mercator grid shades as the same ground
//! in metres would. A neighbour outside the band is extrapolated as gdaldem
//! does at file edges (twice the centre minus the opposite neighbour, rows
//! before columns), which is a one-sided difference; a NoData neighbour is
//! extrapolated the same way where it can be, else takes the centre. A NoData
//! centre stays NoData. Values are grey levels 1–255, rounded, stored as
//! Float32.

use super::super::engine::check_cancel;
use super::super::prepared_raster::RasterWindow;
use super::Cells;
use super::cog::BandSource;
use std::sync::atomic::AtomicBool;

/// The light: from the northwest, 45° above the horizon (D2).
const AZIMUTH_DEGREES: f64 = 315.0;
const ALTITUDE_DEGREES: f64 = 45.0;
/// gdaldem's vertical exaggeration default.
const Z_FACTOR: f64 = 1.0;

/// The grey level of the cell whose 3×3 neighbourhood is `w` (row-major,
/// north row first), on a cell `east` by `north` metres: gdaldem's Horn
/// hillshade.
pub(super) fn grey(w: &[f64; 9], east: f64, north: f64) -> f32 {
    let x = ((w[0] + 2.0 * w[3] + w[6]) - (w[2] + 2.0 * w[5] + w[8])) / east;
    // gdaldem divides by the north-up geotransform's negative row height.
    let y = ((w[6] + 2.0 * w[7] + w[8]) - (w[0] + 2.0 * w[1] + w[2])) / -north;
    let z = Z_FACTOR / 8.0;
    let (azimuth, altitude) = (AZIMUTH_DEGREES.to_radians(), ALTITUDE_DEGREES.to_radians());
    let cos_alt_z = altitude.cos() * z;
    let cang = (altitude.sin() - (y * azimuth.cos() * cos_alt_z - x * azimuth.sin() * cos_alt_z))
        / (1.0 + z * z * (x * x + y * y)).sqrt();
    let value = if cang <= 0.0 { 1.0 } else { 1.0 + 254.0 * cang };
    (value + 0.5).floor().min(255.0) as f32
}

/// The neighbourhood of a cell: `None` for a neighbour outside the band
/// (`outside`) or holding no value.
fn filled(mut w: [Option<f64>; 9], outside: [bool; 9]) -> [f64; 9] {
    let at = |dx: i32, dy: i32| ((dy + 1) * 3 + dx + 1) as usize;
    let mirror =
        |w: &[Option<f64>; 9], centre: usize, opposite: usize| match (w[centre], w[opposite]) {
            (Some(c), Some(o)) => Some(2.0 * c - o),
            _ => None,
        };
    // Rows beyond the band's edge, then columns, as gdaldem's -compute_edges.
    for dy in [-1, 1] {
        if outside[at(0, dy)] {
            for dx in -1..=1 {
                w[at(dx, dy)] = mirror(&w, at(dx, 0), at(dx, -dy));
            }
        }
    }
    for dx in [-1, 1] {
        if outside[at(dx, 0)] {
            for dy in -1..=1 {
                w[at(dx, dy)] = mirror(&w, at(0, dy), at(-dx, dy));
            }
        }
    }
    // Neighbours still empty: one-sided along a row, else along a column,
    // else the centre.
    let known = w;
    let centre = known[4].unwrap_or(0.0);
    let mut out = [0.0; 9];
    for dy in -1..=1 {
        for dx in -1..=1 {
            let index = at(dx, dy);
            out[index] = known[index]
                .or_else(|| {
                    (dx != 0)
                        .then(|| mirror(&known, at(0, dy), at(-dx, dy)))
                        .flatten()
                })
                .or_else(|| {
                    (dy != 0)
                        .then(|| mirror(&known, at(dx, 0), at(dx, -dy)))
                        .flatten()
                })
                .unwrap_or(centre);
        }
    }
    out
}

/// The relief of a `width` × `height` band: each window read with a
/// one-cell halo from the band under it.
pub(super) struct Shaded<'a> {
    source: Box<dyn BandSource + 'a>,
    width: u32,
    height: u32,
    nodata: Option<f32>,
    /// East-west and north-south ground size of a cell of each row, metres.
    ground: Vec<(f64, f64)>,
    /// What a cell with no value is written as.
    fill: f32,
}

impl<'a> Shaded<'a> {
    pub(super) fn new(
        source: Box<dyn BandSource + 'a>,
        (width, height): (u32, u32),
        nodata: Option<f32>,
        ground: Vec<(f64, f64)>,
        fill: f32,
    ) -> Self {
        debug_assert_eq!(ground.len(), height as usize);
        Self {
            source,
            width,
            height,
            nodata,
            ground,
            fill,
        }
    }
}

impl BandSource for Shaded<'_> {
    fn read(
        &mut self,
        window: RasterWindow,
        out: &mut [f32],
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        check_cancel(cancel)?;
        let x0 = window.x.saturating_sub(1);
        let y0 = window.y.saturating_sub(1);
        let x1 = (window.x + window.width + 1).min(self.width);
        let y1 = (window.y + window.height + 1).min(self.height);
        let columns = (x1 - x0) as usize;
        let mut halo = Cells::zeroed(columns * (y1 - y0) as usize);
        self.source.read(
            RasterWindow {
                x: x0,
                y: y0,
                width: x1 - x0,
                height: y1 - y0,
            },
            &mut halo,
            cancel,
        )?;
        let nodata = self.nodata;
        let value = |x: i64, y: i64| -> (Option<f64>, bool) {
            if x < 0 || y < 0 || x >= i64::from(self.width) || y >= i64::from(self.height) {
                return (None, true);
            }
            let sample = halo[(y as usize - y0 as usize) * columns + (x as usize - x0 as usize)];
            let valid = sample.is_finite() && nodata.is_none_or(|marker| sample != marker);
            (valid.then_some(f64::from(sample)), false)
        };
        for row in 0..window.height {
            let y = i64::from(window.y + row);
            let (east, north) = self.ground[y as usize];
            for column in 0..window.width {
                let x = i64::from(window.x + column);
                let target = row as usize * window.width as usize + column as usize;
                if value(x, y).0.is_none() {
                    out[target] = self.fill;
                    continue;
                }
                let mut w = [None; 9];
                let mut outside = [false; 9];
                for dy in -1..=1i64 {
                    for dx in -1..=1i64 {
                        let index = ((dy + 1) * 3 + dx + 1) as usize;
                        (w[index], outside[index]) = value(x + dx, y + dy);
                    }
                }
                out[target] = grey(&filled(w, outside), east, north);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_ground_is_gdaldems_181_and_a_slope_facing_the_light_is_brighter() {
        assert_eq!(grey(&[0.0; 9], 1.0, 1.0), 181.0);
        // Ground rising to the south-east faces the north-west light.
        let facing: [f64; 9] = std::array::from_fn(|i| ((i % 3) + (i / 3)) as f64);
        let away: [f64; 9] = std::array::from_fn(|i| -(((i % 3) + (i / 3)) as f64));
        assert!(grey(&facing, 1.0, 1.0) > 181.0);
        assert!(grey(&away, 1.0, 1.0) < 181.0);
    }

    #[test]
    fn an_edge_neighbour_is_a_one_sided_difference() {
        // A plane rising 1 m per cell eastward, its west column outside.
        let plane: [Option<f64>; 9] = std::array::from_fn(|i| Some((i % 3) as f64));
        let mut edge = plane;
        let mut outside = [false; 9];
        for row in 0..3 {
            edge[row * 3] = None;
            outside[row * 3] = true;
        }
        assert_eq!(filled(edge, outside), filled(plane, [false; 9]));
        // A NoData neighbour on a row is mirrored the same way.
        let mut hole = plane;
        hole[5] = None;
        assert_eq!(filled(hole, [false; 9]), filled(plane, [false; 9]));
    }
}
