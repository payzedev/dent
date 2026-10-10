#!/usr/bin/env python3
import base64, hashlib, json, os, sqlite3, time
from pathlib import Path
from typing import Any
import requests

TELEGRAM = 'https://api.telegram.org/bot' + os.environ['TELEGRAM_BOT_TOKEN']
OLLAMA = os.getenv('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').rstrip('/')
VISION = os.getenv('OLLAMA_VISION_MODEL', 'qwen2.5vl:3b')
TEXT = os.getenv('OLLAMA_TEXT_MODEL', 'qwen2.5:0.5b')
API = os.environ['DENTASTOCK_API_BASE_URL'].rstrip('/')
SECRET = os.environ['DENTASTOCK_WORKER_SECRET']
ALLOWED = {x.strip() for x in os.getenv('TELEGRAM_ALLOWED_USER_IDS', '').split(',') if x.strip()}
DB = Path(os.getenv('TELEGRAM_WORKER_DB', 'telegram_worker.sqlite3'))
TIMEOUT = (10, 120)


def db():
    conn = sqlite3.connect(DB, timeout=30)
    conn.execute('pragma journal_mode = wal')
    conn.execute('create table if not exists drafts (chat_id integer primary key, telegram_user_id integer, payload text not null, updated_at integer not null)')
    columns = {row[1] for row in conn.execute('pragma table_info(drafts)')}
    if 'telegram_user_id' not in columns:
        conn.execute('alter table drafts add column telegram_user_id integer')
    conn.execute('create table if not exists worker_state (name text primary key, value text not null)')
    conn.commit(); return conn


def tg(method: str, payload: dict[str, Any] | None = None, files: dict[str, Any] | None = None):
    response = requests.post(f'{TELEGRAM}/{method}', data=payload, files=files, timeout=TIMEOUT)
    response.raise_for_status(); return response.json()['result']


def send(chat_id: int, text: str, keyboard: list[list[dict[str, str]]] | None = None):
    payload = {'chat_id': chat_id, 'text': text}
    if keyboard: payload['reply_markup'] = json.dumps({'inline_keyboard': keyboard})
    tg('sendMessage', payload)


def allowed(user_id: int) -> bool:
    return str(user_id) in ALLOWED


def ollama_ready() -> tuple[bool, str]:
    try:
        models = requests.get(f'{OLLAMA}/api/tags', timeout=10).json().get('models', [])
        names = {m.get('name') for m in models}
        missing = [m for m in (VISION, TEXT) if m not in names]
        return (not missing, 'Faltan modelos: ' + ', '.join(missing)) if missing else (True, 'Ollama disponible')
    except requests.RequestException as exc: return False, f'Ollama no disponible: {exc}'


def analyze(image: bytes, note: str) -> dict[str, Any]:
    prompt = '''Analiza este producto dental y responde SOLO JSON válido con estas claves: name,description,barcode,brand,category_id,brand_id,presentation,product_type,model,color. No inventes datos; usa null o cadena vacía si no son visibles. presentation debe ser individual, set o box.'''
    response = requests.post(f'{OLLAMA}/api/chat', json={'model': VISION, 'stream': False, 'format': 'json', 'messages': [{'role': 'user', 'content': prompt + '\nInformación adicional: ' + note, 'images': [base64.b64encode(image).decode()]}]}, timeout=180)
    response.raise_for_status()
    value = json.loads(response.json()['message']['content'])
    value['name'] = str(value.get('name') or '').strip()[:180]
    value['description'] = str(value.get('description') or '').strip()[:2000]
    value['idempotency_key'] = hashlib.sha256((str(time.time_ns()) + value['name']).encode()).hexdigest()
    return value


def draft(chat_id: int, telegram_user_id: int, payload: dict[str, Any]):
    conn = db()
    conn.execute('insert or replace into drafts values (?, ?, ?, ?)', (chat_id, telegram_user_id, json.dumps(payload), int(time.time())))
    conn.commit(); conn.close()


def get_draft(chat_id: int, telegram_user_id: int):
    conn = db(); row = conn.execute('select payload from drafts where chat_id = ? and telegram_user_id = ?', (chat_id, telegram_user_id)).fetchone(); conn.close()
    return json.loads(row[0]) if row else None


def handle_message(message: dict[str, Any]):
    user = message['from']; chat_id = message['chat']['id']
    if message['chat'].get('type') != 'private': return
    if not allowed(user['id']): send(chat_id, 'Acceso denegado.'); return
    text = message.get('text', '').strip()
    if text in ('/start', '/help'):
        send(chat_id, 'DentaStock: envía una foto de un producto dental. Usa /nuevo para iniciar, /buscar texto, /status o /cancel.')
    elif text == '/status':
        ok, status = ollama_ready(); send(chat_id, status + ('\nAPI configurada.' if API and SECRET else '\nAPI no configurada.'))
    elif text in ('/nuevo', '/cancel'):
        conn = db(); conn.execute('delete from drafts where chat_id = ?', (chat_id,)); conn.commit(); conn.close(); send(chat_id, 'Borrador cancelado.' if text == '/cancel' else 'Envía la fotografía del producto con una nota opcional.')
    elif text.startswith('/buscar '):
        response = requests.get(f'{API}/api/telegram/catalog', params={'q': text[8:]}, headers=headers(user['id']), timeout=TIMEOUT)
        send(chat_id, json.dumps(response.json(), ensure_ascii=False)[:3500])
    elif message.get('photo'):
        photo = message['photo'][-1]; file = tg('getFile', {'file_id': photo['file_id']}); image = requests.get(f"https://api.telegram.org/file/bot{os.environ['TELEGRAM_BOT_TOKEN']}/{file['file_path']}", timeout=TIMEOUT).content
        ok, status = ollama_ready()
        if not ok: send(chat_id, status + '\nInstala el modelo y reintenta.'); return
        payload = analyze(image, message.get('caption', '')); draft(chat_id, user['id'], payload)
        send(chat_id, 'Propuesta:\n' + json.dumps(payload, ensure_ascii=False, indent=2)[:3500], [[{'text': 'Confirmar y crear ficha', 'callback_data': 'confirm'}, {'text': 'Cancelar', 'callback_data': 'cancel'}]])


def headers(user_id: int): return {'Authorization': f'Bearer {SECRET}', 'X-Telegram-User-Id': str(user_id), 'Content-Type': 'application/json'}


def callback(query: dict[str, Any]):
    user_id = query['from']['id']; chat_id = query['message']['chat']['id']; action = query['data']
    tg('answerCallbackQuery', {'callback_query_id': query['id']})
    if not allowed(user_id): send(chat_id, 'Acceso denegado.'); return
    if action == 'cancel':
        conn = db(); conn.execute('delete from drafts where chat_id = ? and telegram_user_id = ?', (chat_id, user_id)); conn.commit(); conn.close(); send(chat_id, 'Borrador cancelado.'); return
    payload = get_draft(chat_id, user_id)
    if not payload: send(chat_id, 'El borrador expiró. Usa /nuevo.'); return
    response = requests.post(f'{API}/api/telegram/catalog', headers=headers(user_id), json=payload, timeout=TIMEOUT)
    if response.status_code in (200, 201): db().execute('delete from drafts where chat_id = ?', (chat_id,)).connection.commit(); send(chat_id, 'Producto agregado al catálogo compartido. ID: ' + response.json()['product_id'])
    else: send(chat_id, 'No se pudo crear la ficha: ' + response.text[:500])


def main():
    offset = 0
    while True:
        try:
            updates = tg('getUpdates', {'timeout': 25, 'offset': offset})
            for update in updates:
                offset = update['update_id'] + 1
                if 'callback_query' in update: callback(update['callback_query'])
                elif 'message' in update: handle_message(update['message'])
        except Exception as exc:
            print(f'worker error: {type(exc).__name__}')
            time.sleep(5)

if __name__ == '__main__': main()
