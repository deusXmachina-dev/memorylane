use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use cidre::{
    arc, blocks, cf, cg, cm, cv, define_obj_type, dispatch, ns, objc, sc,
    sc::stream::{Output, OutputImpl},
    vt,
};

use crate::events::now_ms;
use crate::types::SavedCapture;

const STREAM_START_TIMEOUT: Duration = Duration::from_secs(2);
const STREAM_STOP_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Default)]
struct LatestFrameState {
    latest_sample: Option<arc::R<cm::SampleBuf>>,
}

define_obj_type!(
    LatestFrameOutput + OutputImpl,
    LatestFrameState,
    LATEST_FRAME_OUTPUT_CLS
);

impl Output for LatestFrameOutput {}

#[objc::add_methods]
impl OutputImpl for LatestFrameOutput {
    extern "C" fn impl_stream_did_output_sample_buf(
        &mut self,
        _cmd: Option<&cidre::objc::Sel>,
        _stream: &sc::Stream,
        sample_buf: &mut cm::SampleBuf,
        kind: sc::OutputType,
    ) {
        if kind != sc::OutputType::Screen || sample_buf.image_buf().is_none() {
            return;
        }
        self.inner_mut().latest_sample = Some(sample_buf.retained());
    }
}

pub(crate) struct DisplayStreamSession {
    display_id: u32,
    stream: arc::R<sc::Stream>,
    output: arc::R<LatestFrameOutput>,
    queue: arc::R<dispatch::Queue>,
}

impl DisplayStreamSession {
    pub(crate) fn start(display: &sc::Display, display_id: u32) -> Result<Self, String> {
        let empty_windows = ns::Array::new();
        let filter = sc::ContentFilter::with_display_excluding_windows(display, &empty_windows);
        let mut cfg = sc::StreamCfg::new();
        cfg.set_shows_cursor(false);
        cfg.set_pixel_format(cv::PixelFormat::_32_BGRA);
        cfg.set_queue_depth(3);

        let queue = dispatch::Queue::serial_with_ar_pool();
        let stream = sc::Stream::new(&filter, &cfg);
        let output = LatestFrameOutput::with(LatestFrameState::default());
        let output_ref: &LatestFrameOutput = output.as_ref();

        stream
            .add_stream_output(output_ref, sc::OutputType::Screen, Some(&queue))
            .map_err(|err| format!("Failed to add stream output: {err}"))?;

        if let Err(err) = start_stream_capture(&stream) {
            let _ = stream.remove_stream_output(output_ref, sc::OutputType::Screen);
            return Err(err);
        }

        Ok(Self {
            display_id,
            stream,
            output,
            queue,
        })
    }

    pub(crate) fn display_id(&self) -> u32 {
        self.display_id
    }

    pub(crate) fn save_latest_display_image(
        &self,
        output_dir: &Path,
    ) -> Result<Option<SavedCapture>, String> {
        let sample = self.queue.sync_once(|| {
            self.output
                .inner()
                .latest_sample
                .as_ref()
                .map(|s| s.retained())
        });
        let Some(sample) = sample else {
            return Ok(None);
        };

        let image_buf = sample.image_buf().ok_or_else(|| {
            "Latest ScreenCaptureKit frame did not contain an image buffer".to_string()
        })?;
        let image = vt::cg_image_from_cv_pixel_buf(image_buf, None)
            .map_err(|err| format!("Failed to create CGImage from stream pixel buffer: {err:?}"))?;

        save_cg_image(&image, self.display_id, output_dir).map(Some)
    }
}

impl Drop for DisplayStreamSession {
    fn drop(&mut self) {
        let output_ref: &LatestFrameOutput = self.output.as_ref();
        let _ = stop_stream_capture(&self.stream);
        let _ = self
            .stream
            .remove_stream_output(output_ref, sc::OutputType::Screen);
    }
}

fn start_stream_capture(stream: &sc::Stream) -> Result<(), String> {
    let (tx, rx) = mpsc::sync_channel(1);
    let mut handler = blocks::ErrCh::new1(move |error: Option<&ns::Error>| {
        let result = match error {
            Some(err) => Err(format!("Failed to start ScreenCaptureKit stream: {err}")),
            None => Ok(()),
        };
        let _ = tx.send(result);
    });
    stream.start_with_ch_block(Some(&mut handler));

    match rx.recv_timeout(STREAM_START_TIMEOUT) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err("Timed out waiting for ScreenCaptureKit stream start".to_string())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("ScreenCaptureKit stream start callback disconnected".to_string())
        }
    }
}

fn stop_stream_capture(stream: &sc::Stream) -> Result<(), String> {
    let (tx, rx) = mpsc::sync_channel(1);
    let mut handler = blocks::ErrCh::new1(move |error: Option<&ns::Error>| {
        let result = match error {
            Some(err) => Err(format!("Failed to stop ScreenCaptureKit stream: {err}")),
            None => Ok(()),
        };
        let _ = tx.send(result);
    });
    stream.stop_with_ch_block(Some(&mut handler));

    match rx.recv_timeout(STREAM_STOP_TIMEOUT) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err("Timed out waiting for ScreenCaptureKit stream stop".to_string())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("ScreenCaptureKit stream stop callback disconnected".to_string())
        }
    }
}

fn save_cg_image(
    image: &cg::Image,
    display_id: u32,
    output_dir: &Path,
) -> Result<SavedCapture, String> {
    let filename = format!("frame-{}-{}.png", now_ms(), display_id);
    let output_path = output_dir.join(filename);
    let output_url = cf::Url::with_file_path(&output_path).ok_or_else(|| {
        format!(
            "Failed to create CFURL for output path {}",
            output_path.display()
        )
    })?;
    let png_type = cf::String::from_str("public.png");

    let mut destination = cg::ImageDst::with_url(&output_url, &png_type, 1).ok_or_else(|| {
        format!(
            "Failed to create image destination for {}",
            output_path.display()
        )
    })?;
    destination.add_image(image, None);
    if !destination.finalize() {
        return Err(format!(
            "Failed to finalize PNG write for {}",
            output_path.display()
        ));
    }

    Ok(SavedCapture {
        filepath: output_path.to_string_lossy().to_string(),
        width: image.width(),
        height: image.height(),
    })
}
