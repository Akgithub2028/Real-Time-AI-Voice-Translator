import asyncio
import time
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from src import main
from src.limits import DemoLimits
from test_pipeline import SPEECH


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        main.limits = DemoLimits()

    def test_ready_exposes_missing_configuration_without_secrets(self):
        with patch('src.main.missing_configuration', return_value=['GROQ_API_KEY'], create=True):
            r = self.client.get('/ready')
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()['missing'], ['GROQ_API_KEY'])

    def test_stop_acknowledges_after_handshake(self):
        with patch('src.main.missing_configuration', return_value=[], create=True):
            with self.client.websocket_connect('/ws/translate', headers={'origin': 'http://localhost:3000'}) as ws:
                ws.send_json({'target_language': 'Hindi'})
                ws.send_json({'action': 'stop'})
                self.assertEqual(ws.receive_json()['type'], 'ready')
                self.assertEqual(ws.receive_json()['type'], 'stopped')

    def test_foreign_origin_is_rejected(self):
        with self.assertRaises(WebSocketDisconnect) as e:
            with self.client.websocket_connect('/ws/translate', headers={'origin': 'https://attacker.example'}) as ws:
                ws.send_json({'target_language': 'Martian'})
                ws.receive_json()
        self.assertEqual(e.exception.code, 1008)

    def test_array_handshake_is_rejected_cleanly(self):
        with self.assertRaises(WebSocketDisconnect) as e:
            with self.client.websocket_connect('/ws/translate', headers={'origin': 'http://localhost:3000'}) as ws:
                ws.send_json([])
                self.assertEqual(ws.receive_json()['type'], 'error')
                ws.receive_json()
        self.assertEqual(e.exception.code, 1003)

    def test_stop_flushes_final_speech_and_delivers_audio_before_ack(self):
        with patch('src.main.missing_configuration', return_value=[]), patch('src.pipeline.transcribe_chunk', return_value='Hello world'), patch('src.pipeline.translate', return_value='नमस्ते'), patch('src.pipeline.synthesize_stream', return_value=iter([b'\x01\x00'])):
            with self.client.websocket_connect('/ws/translate', headers={'origin':'http://localhost:3000'}) as ws:
                ws.send_json({'target_language':'Hindi'})
                self.assertEqual(ws.receive_json()['type'], 'ready')
                for _ in range(20):
                    ws.send_bytes(SPEECH)
                ws.send_json({'action':'stop'})
                events = []
                audio = b''
                while True:
                    event = ws.receive()
                    if 'bytes' in event:
                        audio += event['bytes']
                    else:
                        import json
                        payload = json.loads(event['text'])
                        events.append(payload)
                        if payload['type']=='stopped':
                            break
                captions = [e for e in events if e['type']=='transcript']
                self.assertEqual(captions[0]['translated_text'], 'नमस्ते')
                self.assertEqual(audio, b'\x01\x00\x01\x00')
                self.assertEqual(events[-1]['type'], 'stopped')

    def test_oversized_pcm_packet_closes_cleanly(self):
        with patch('src.main.missing_configuration', return_value=[]):
            with self.client.websocket_connect('/ws/translate', headers={'origin':'http://localhost:3000'}) as ws:
                ws.send_json({'target_language':'Hindi'})
                ws.receive_json()
                ws.send_bytes(bytes(9602))
                self.assertEqual(ws.receive_json()['type'], 'error')
                with self.assertRaises(WebSocketDisconnect) as e:
                    ws.receive_json()
                self.assertEqual(e.exception.code, 1003)

    def test_session_timeout_releases_capacity(self):
        with patch('src.main.SESSION_SECONDS', .05), patch('src.main.missing_configuration', return_value=[]):
            with self.client.websocket_connect('/ws/translate', headers={'origin':'http://localhost:3000'}) as ws:
                ws.send_json({'target_language':'Hindi'})
                ws.receive_json()
                self.assertEqual(ws.receive_json()['type'], 'info')
        self.assertEqual(main.limits.active, 0)


class ResponsivenessTests(unittest.IsolatedAsyncioTestCase):
    async def test_stop_surfaces_worker_failure_even_when_queue_is_full(self):
        from src.limits import DemoLimit
        queue = asyncio.Queue(maxsize=2)
        queue.put_nowait(b'first')
        queue.put_nowait(b'second')
        async def failing_worker():
            await asyncio.sleep(.01)
            raise DemoLimit('Provider quota reached')
        worker = asyncio.create_task(failing_worker())
        with self.assertRaisesRegex(DemoLimit, 'Provider quota reached'):
            await asyncio.wait_for(main.finish_processing(queue, worker, [b'final']), timeout=.2)

    async def test_slow_generator_does_not_block_event_loop(self):
        def slow_provider():
            time.sleep(.12)
            yield {'type': 'transcript'}
        async def consume():
            return [x async for x in main.stream_results(slow_provider())]
        task = asyncio.create_task(consume())
        started = time.monotonic()
        await asyncio.sleep(.02)
        self.assertLess(time.monotonic() - started, .09)
        self.assertEqual(await task, [{'type': 'transcript'}])
