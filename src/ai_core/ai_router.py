import json
import os
from typing import Type, TypeVar
from pydantic import BaseModel
from litellm import completion
from dotenv import load_dotenv

# Load .env only if not already loaded (engine.py loads first)
if not os.environ.get('GEMINI_API_KEY'):
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))
    # Strip BOM from env vars (Windows UTF-8 BOM issue)
    for key in list(os.environ.keys()):
        if key.startswith('\ufeff'):
            clean_key = key.replace('\ufeff', '')
            os.environ[clean_key] = os.environ.pop(key)

T = TypeVar('T', bound=BaseModel)

ALIASES = {
    'free-lead-scorer': [
        'gemini/gemini-2.0-flash',
        'groq/llama-3.1-8b-instant',
        'openrouter/google/gemma-4-26b-a4b-it:free',
        'openrouter/meta-llama/llama-3.3-70b-instruct:free',
    ],
    'free-proposal-generator': [
        'gemini/gemini-2.0-flash',
        'openrouter/google/gemma-4-31b-it:free',
        'openrouter/deepseek/deepseek-v4-flash:free',
        'groq/llama-3.3-70b-versatile',
        'cloudflare/@cf/meta/llama-3.3-70b-instruct',
    ],
    'free-backup-agent': [
        'gemini/gemini-2.0-flash',
        'groq/llama-3.1-8b-instant',
        'openrouter/google/gemma-4-26b-a4b-it:free',
        'huggingface/meta-llama/Llama-3.3-70B-Instruct',
    ],
}

COOLDOWN: dict[str, float] = {}
COOLDOWN_SECONDS = 60


def _resolve_models(alias: str) -> list[str]:
    return ALIASES.get(alias, [alias])


def _is_in_cooldown(model: str) -> bool:
    import time
    until = COOLDOWN.get(model)
    if until and time.time() < until:
        return True
    if until:
        del COOLDOWN[model]
    return False


def _set_cooldown(model: str):
    import time
    COOLDOWN[model] = time.time() + COOLDOWN_SECONDS


def _get_api_key(model: str) -> str | None:
    base = model.split(':')[0].split('/')[-1]
    if model.startswith('gemini/') or 'gemini' in model.lower() or 'gemma' in model.lower():
        return os.environ.get('GEMINI_API_KEY')
    if model.startswith('groq/'):
        return os.environ.get('GROQ_API_KEY')
    if model.startswith('openrouter/'):
        return os.environ.get('OPENROUTER_API_KEY')
    if model.startswith('cloudflare/'):
        return os.environ.get('CLOUDFLARE_API_TOKEN')
    if model.startswith('huggingface/') or model.startswith('hf/'):
        return os.environ.get('HF_TOKEN')
    return None


def _extract_json(text: str) -> str:
    code_match = __import__('re').search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if code_match:
        text = code_match.group(1).strip()
    text = __import__('re').sub(r'//[^\n]*$', '', text, flags=__import__('re').MULTILINE)
    text = __import__('re').sub(r'/\*[\s\S]*?\*/', '', text)
    start = text.find('{')
    if start == -1:
        return text
    end = text.rfind('}')
    if end == -1 or end < start:
        return text
    return text[start:end + 1]


def call(alias: str, prompt: str, system_prompt: str = '', response_model: Type[T] | None = None, max_retries: int = 2) -> T | str:
    models = _resolve_models(alias)
    if not models:
        raise ValueError(f'Unknown alias: {alias}')

    messages = []
    if system_prompt:
        messages.append({'role': 'system', 'content': system_prompt})
    messages.append({'role': 'user', 'content': prompt})

    last_error = None

    for attempt in range(max_retries + 1):
        for model in models:
            if _is_in_cooldown(model):
                print(f'[LiteLLM] {model} in cooldown, skipping')
                continue

            api_key = _get_api_key(model)
            if not api_key:
                print(f'[LiteLLM] {model} skipped — API key not configured')
                continue

            try:
                kwargs = {
                    'model': model,
                    'messages': messages,
                    'temperature': 0.7,
                    'max_tokens': 2000,
                }

                if response_model:
                    kwargs['response_format'] = {
                        'type': 'json_object',
                    }

                import time
                start = time.time()
                resp = completion(**kwargs)
                duration = time.time() - start

                text = resp['choices'][0]['message']['content'].strip()
                tokens = resp.get('usage', {}).get('total_tokens', 0)
                print(f'[LiteLLM] {model} | {tokens} tokens | {duration:.0f}ms')

                if response_model:
                    cleaned = _extract_json(text)
                    parsed = json.loads(cleaned)
                    return response_model.model_validate(parsed)

                return text

            except Exception as e:
                last_error = e
                msg = str(e).lower()
                err_type = type(e).__name__.lower()
                # Don't retry Pydantic/validation errors — they're not API issues
                if 'validation' in err_type or 'pydantic' in err_type:
                    raise
                if '429' in msg or 'rate limit' in msg or 'resource_exhausted' in msg or 'quota' in msg:
                    print(f'[LiteLLM] {model} rate limited, entering cooldown')
                    _set_cooldown(model)
                    continue
                if 'api key' in msg or 'apikey' in msg or 'api_key' in msg or 'authentication' in msg or 'authorization' in msg:
                    print(f'[LiteLLM] {model} skipped (auth error), trying next')
                    continue
                print(f'[LiteLLM] {model} failed: {e}')
                break

    raise RuntimeError(f'LiteLLM: all models failed for alias "{alias}": {last_error}')
