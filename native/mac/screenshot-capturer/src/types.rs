#[derive(Debug, Clone, Copy)]
pub(crate) struct RectF64 {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Debug)]
pub(crate) struct SavedCapture {
    pub(crate) filepath: String,
    pub(crate) width: usize,
    pub(crate) height: usize,
}
