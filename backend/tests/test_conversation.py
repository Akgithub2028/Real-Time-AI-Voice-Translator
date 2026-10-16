import json
import struct
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from src import main, stt, tts
from src.limits import DemoLimits
from src.observability import Monitor
from src.pipeline import TranslationPipeline
from test_pipeline import SPEECH


class StreamingTests(unittest.TestCase):
    def test_tts_uses_streaming_endpoint_and_aligns_samples(self):
        client = SimpleNamespace(text_to_speech=SimpleNamespace(
            stream=Mock(return_value=iter([b'\x01', b'\x00\x02\x00'])),
            convert=Mock(side_effect=AssertionError('Non-streaming endpoint used'))))
        with patch('src.tts._client', return_value=client):
            result = b''.join(tts.synthesize_stream('Hello'))
        self.assertEqual(result, b'\x01\x00\x02\x00')
        client.text_to_speech.stream.assert_called_once()

    def test_recognition_receives_explicit_source_language(self):
        create = Mock(return_value='Hello')
        client = SimpleNamespace(audio=SimpleNamespace(transcriptions=SimpleNamespace(create=create)))
        with patch('src.stt._client', return_value=client):
            result = stt.transcribe_chunk(SPEECH * 20, language='hi')
        self.assertEqual(result, 'Hello')
        self.assertEqual(create.call_args.kwargs['language'], 'hi')


class ConversationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        main.limits = DemoLimits()

    def connect(self):
        return self.client.websocket_connect('/ws/translate', headers={'origin':'http://localhost:3000'})

    def test_v2_switches_direction_without_reconnecting(self):
        with patch('src.main.missing_configuration', return_value=[]):
            with self.connect() as ws:
                ws.send_json({'protocol':2,'source_language':'English','target_language':'Hindi'})
                ready = ws.receive_json()
                self.assertEqual(ready.get('protocol'), 2)
                ws.send_json({'action':'interrupt','turn_id':1,'source_language':'Hindi','target_language':'English'})
                ack = ws.receive_json()
                self.assertEqual(ack['type'], 'turn_ready')
                self.assertEqual(ack['turn_id'], 1)
                self.assertEqual(ack['target_language'], 'English')
                ws.send_json({'action':'stop'})
                self.assertEqual(ws.receive_json()['type'], 'stopped')

    def test_v2_audio_is_tagged_and_exposes_real_stage_timings(self):
        with patch('src.main.missing_configuration', return_value=[]), patch('src.pipeline.transcribe_chunk', return_value='नमस्ते') as stt_call, patch('src.pipeline.translate', return_value='Hello'), patch('src.pipeline.synthesize_stream', side_effect=lambda _:iter([b'\x01\x00'])):
            with self.connect() as ws:
                ws.send_json({'protocol':2,'source_language':'Hindi','target_language':'English'})
                self.assertEqual(ws.receive_json().get('protocol'),2)
                for _ in range(20):
                    ws.send_bytes(struct.pack('!Id',0,1000.0)+SPEECH)
                ws.send_json({'action':'stop'})
                events=[];audio=[]
                while True:
                    message=ws.receive()
                    if message.get('bytes') is not None:
                        audio.append(message['bytes'])
                    else:
                        event=json.loads(message['text']);events.append(event)
                        if event['type']=='stopped':break
                self.assertEqual(stt_call.call_args.kwargs['language'],'hi')
                transcript=next(x for x in events if x['type']=='transcript')
                self.assertEqual(transcript['source_language'],'Hindi')
                self.assertEqual(struct.unpack('!II',audio[0][:8]),(0,transcript['utterance_id']))
                self.assertEqual(audio[0][8:],b'\x01\x00\x01\x00')
                timing=next(x for x in events if x['type']=='metrics')
                self.assertGreaterEqual(timing['timings']['stt_ms'],0)
                self.assertGreaterEqual(timing['timings']['tts_first_byte_ms'],0)

    def test_interrupt_ack_is_immediate_while_old_provider_is_blocked(self):
        entered=threading.Event();release=threading.Event()
        def slow_stt(*args,**kwargs):
            entered.set();release.wait(2);return 'obsolete words'
        with patch('src.main.missing_configuration', return_value=[]), patch('src.pipeline.transcribe_chunk', side_effect=slow_stt), patch('src.pipeline.translate', return_value='obsolete translation'):
            with self.connect() as ws:
                ws.send_json({'protocol':2,'source_language':'English','target_language':'Hindi'})
                self.assertEqual(ws.receive_json().get('protocol'),2)
                for _ in range(20):ws.send_bytes(struct.pack('!Id',0,1000.0)+SPEECH)
                for _ in range(30):ws.send_bytes(struct.pack('!Id',0,1000.0)+bytes(1920))
                self.assertTrue(entered.wait(1))
                try:
                    ws.send_json({'action':'interrupt','turn_id':1,'source_language':'Hindi','target_language':'English'})
                    while True:
                        event=ws.receive_json()
                        if event['type']=='turn_ready':break
                    self.assertFalse(release.is_set())
                    self.assertEqual(event['turn_id'],1)
                finally:release.set()
                ws.send_json({'action':'stop'})
                events=[]
                while True:
                    event=ws.receive_json();events.append(event)
                    if event['type']=='stopped':break
                self.assertFalse(any(x['type']=='transcript' for x in events))

    def test_metrics_are_aggregate_and_do_not_expose_configuration_values(self):
        response=self.client.get('/metrics')
        self.assertEqual(response.status_code,200)
        data=response.json()
        self.assertIn('uptime_seconds',data)
        self.assertIn('providers',data)
        self.assertIn('latency',data)
        self.assertNotIn('source_text',response.text)
        self.assertNotIn('API_KEY',response.text)


class MonitorTests(unittest.TestCase):
    def test_latency_window_is_bounded_and_percentiles_are_measured(self):
        monitor = Monitor()
        for number in range(200):
            monitor.observe('stt_ms', number)
        for invalid in [-1, float('nan'), float('inf')]:
            monitor.observe('stt_ms', invalid)
        snapshot = monitor.snapshot({}, dict.fromkeys(['stt', 'translation', 'tts'], True), dict.fromkeys(['stt', 'translation', 'tts'], 'model'))
        self.assertEqual(snapshot['latency']['stt_ms'], {'samples':120, 'p50_ms':139.5, 'p95_ms':193, 'latest_ms':199})

    def test_provider_failure_is_sanitized_and_success_recovers(self):
        monitor = Monitor()
        monitor.stage_error('tts', SimpleNamespace(status_code=429))
        kwargs = dict(limits={}, configured=dict.fromkeys(['stt', 'translation', 'tts'], True), models=dict.fromkeys(['stt', 'translation', 'tts'], 'model'))
        self.assertEqual(monitor.snapshot(**kwargs)['providers']['tts']['status'], 'degraded')
        monitor.stage_success('tts_first_byte', 215)
        snapshot = monitor.snapshot(**kwargs)
        self.assertEqual(snapshot['providers']['tts']['status'], 'observed_ok')
        self.assertEqual(snapshot['recent_errors'][0]['category'], 'quota')
        self.assertEqual(snapshot['providers']['translation']['status'], 'unobserved')


class CancellationBoundaryTests(unittest.TestCase):
    def test_cancelled_status_never_starts_the_next_provider(self):
        for stage, provider in [('transcribing', 'stt'), ('translating', 'translation'), ('speaking', 'tts')]:
            with self.subTest(stage=stage), patch('src.pipeline.transcribe_chunk', return_value='Hello') as stt_call, patch('src.pipeline.translate', return_value='नमस्ते') as translation, patch('src.pipeline.synthesize_stream', return_value=iter([b'\x01\x00'])) as tts_call:
                pipeline = TranslationPipeline('Hindi', 'English')
                generator = pipeline._run_cycle(SPEECH * 20)
                for result in generator:
                    if result == {'type':'status', 'stage':stage}:
                        pipeline.cancelled.set()
                calls = {'stt':stt_call, 'translation':translation, 'tts':tts_call}
                calls[provider].assert_not_called()
