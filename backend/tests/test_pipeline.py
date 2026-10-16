import unittest
from unittest.mock import patch
import numpy as np

from src.pipeline import TranslationPipeline
from src.stt import _downsample_48k_to_16k
from src.vad import is_speech

SPEECH = np.full(960, 4000, dtype='<i2').tobytes()
SILENCE = bytes(1920)


class PipelineTests(unittest.TestCase):
    def test_vad_returns_python_boolean(self):
        self.assertIs(is_speech(SPEECH), True)

    def test_short_click_followed_by_silence_does_not_call_providers(self):
        with patch('src.pipeline.transcribe_chunk', return_value='A click') as stt, patch('src.pipeline.translate', return_value=''), patch('src.pipeline.synthesize_stream', return_value=iter([])):
            p = TranslationPipeline('Hindi')
            list(p.feed(SPEECH + SILENCE * 30))
            self.assertEqual(stt.call_count, 0)

    def test_ingestion_returns_utterance_without_running_provider_calls(self):
        p = TranslationPipeline('Hindi')
        chunks = p.feed_audio(SPEECH * 20 + SILENCE * 30)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0][:1920], SPEECH)

    def test_finalize_retains_partial_pcm_frame(self):
        p = TranslationPipeline('Hindi')
        p.feed_audio(SPEECH * 20 + SPEECH[:100])
        chunks = p.finalize_audio()
        self.assertEqual(len(chunks), 1)
        self.assertTrue(chunks[0].endswith(SPEECH[:100]))

    def test_real_thank_you_is_translated(self):
        with patch('src.pipeline.transcribe_chunk', return_value='Thank you.'), patch('src.pipeline.translate', return_value='धन्यवाद'), patch('src.pipeline.synthesize_stream', return_value=iter([b'\x01\x00'])):
            events = [e for e in TranslationPipeline('Hindi')._run_cycle(SPEECH * 20) if e['type'] in ('transcript', 'audio')]
        self.assertEqual(events[0]['translated_text'], 'धन्यवाद')
        self.assertEqual(events[1]['data'], b'\x01\x00\x01\x00')

    def test_downsample_preserves_signal(self):
        x = (5000 * np.sin(np.arange(48000) * 2*np.pi*440/48000)).astype('<i2')
        y = np.frombuffer(_downsample_48k_to_16k(x.tobytes()), dtype='<i2')
        self.assertEqual(len(y), 16000)
        self.assertGreater(int(np.abs(y).max()), 4500)


if __name__ == '__main__':
    unittest.main()
