"""
AI Router — LiteLLM Unified Gateway

Routes AI prompts through a multi-provider cascade (FreeLLMAPI, Gemini, Groq,
OpenRouter, Cloudflare, Hugging Face) with automatic fallback, per-model
cooldown, and Pydantic response validation.

All models share a single FreeLLMAPI key with different model identifiers.
"""

import json
import os
import re
import time
from typing import Type, TypeVar

from pydantic import BaseModel
from litellm import completion
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Environment Setup
# ---------------------------------------------------------------------------

if not os.environ.get("GEMINI_API_KEY"):
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
    for key in list(os.environ.keys()):
        if key.startswith("\ufeff"):
            clean_key = key.replace("\ufeff", "")
            os.environ[clean_key] = os.environ.pop(key)

T = TypeVar("T", bound=BaseModel)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

FREELLM_API_URL = os.environ.get("FREELLM_API_URL", "https://free.llm-api.com/v1")
FREELLM_API_KEY = os.environ.get("FREELLM_API_KEY")

COOLDOWN: dict[str, float] = {}
COOLDOWN_SECONDS: float = 60.0

# Functional alias → ordered model cascade (tiered fallback)
ALIASES: dict[str, list[str]] = {
    "free-lead-scorer": [
        # Tier 1 — Core (highest quality)
        "free-llm/gemini-2.5-flash",
        "free-llm/groq/llama-3.3-70b-versatile",
        "free-llm/deepseek-chat",
        # Tier 2 — Ultra-Fast & Edge
        "free-llm/cerebras/qwen3-235b-a22b",
        "free-llm/sambanova/llama-4-scout",
        "free-llm/cloudflare/kimi-k2.6",
        # Tier 3 — Premium Heavy Fallbacks
        "free-llm/github/gpt-4o",
        "free-llm/zhipu/glm-4.7-flash",
        "free-llm/cohere/command-r-plus",
    ],
    "free-proposal-generator": [
        # Tier 1 — Core (best for creative Arabic text)
        "free-llm/gemini-2.5-flash",
        "free-llm/deepseek-chat",
        "free-llm/groq/llama-3.3-70b-versatile",
        # Tier 2 — Ultra-Fast & Edge
        "free-llm/cerebras/qwen3-235b-a22b",
        "free-llm/sambanova/llama-4-scout",
        "free-llm/cloudflare/kimi-k2.6",
        # Tier 3 — Premium Heavy Fallbacks
        "free-llm/github/gpt-4o",
        "free-llm/zhipu/glm-4.7-flash",
        "free-llm/cohere/command-r-plus",
    ],
    "free-backup-agent": [
        "free-llm/gemini-2.5-flash",
        "free-llm/groq/llama-3.3-70b-versatile",
        "free-llm/deepseek-chat",
        "free-llm/cerebras/qwen3-235b-a22b",
        "free-llm/sambanova/llama-4-scout",
        "free-llm/cloudflare/kimi-k2.6",
        "free-llm/github/gpt-4o",
        "free-llm/zhipu/glm-4.7-flash",
        "free-llm/cohere/command-r-plus",
    ],
}

# ---------------------------------------------------------------------------
# Internal Helpers
# ---------------------------------------------------------------------------


def _resolve_models(alias: str) -> list[str]:
    """Return the model cascade for a functional alias."""
    return ALIASES.get(alias, [alias])


def _is_in_cooldown(model: str) -> bool:
    """Check if a model is within its rate-limit cooldown window."""
    until = COOLDOWN.get(model)
    if until and time.time() < until:
        return True
    if until:
        del COOLDOWN[model]
    return False


def _set_cooldown(model: str) -> None:
    """Mark a model as rate-limited for the cooldown duration."""
    COOLDOWN[model] = time.time() + COOLDOWN_SECONDS


def _get_api_key(model: str) -> str | None:
    """Resolve the correct API key for a model based on its provider prefix."""
    if model.startswith("free-llm/"):
        return FREELLM_API_KEY
    base = model.split(":")[0].split("/")[-1]
    if model.startswith("gemini/") or "gemini" in model.lower() or "gemma" in model.lower():
        return os.environ.get("GEMINI_API_KEY")
    if model.startswith("groq/"):
        return os.environ.get("GROQ_API_KEY")
    if model.startswith("openrouter/"):
        return os.environ.get("OPENROUTER_API_KEY")
    if model.startswith("cloudflare/"):
        return os.environ.get("CLOUDFLARE_API_TOKEN")
    if model.startswith("huggingface/") or model.startswith("hf/"):
        return os.environ.get("HF_TOKEN")
    return None


def _extract_json(text: str) -> str:
    """Extract the first valid JSON object from LLM response text."""
    code_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if code_match:
        text = code_match.group(1).strip()
    text = re.sub(r"//[^\n]*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"/\*[\s\S]*?\*/", "", text)
    start = text.find("{")
    if start == -1:
        return text
    end = text.rfind("}")
    if end == -1 or end < start:
        return text
    return text[start : end + 1]

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def call(
    alias: str,
    prompt: str,
    system_prompt: str = "",
    response_model: Type[T] | None = None,
    max_retries: int = 2,
) -> T | str:
    """
    Call the AI router with a functional alias and prompt.

    Iterates through the model cascade with automatic cooldown and retry.
    If response_model is provided, validates the JSON response against the
    Pydantic model before returning.

    Args:
        alias: Functional alias name (e.g. 'free-lead-scorer')
        prompt: User prompt text
        system_prompt: Optional system instruction
        response_model: Pydantic model for structured response validation
        max_retries: Number of full cascade retries

    Returns:
        Validated Pydantic model instance or raw response text

    Raises:
        ValueError: If alias is unknown
        RuntimeError: If all models in the cascade fail
    """
    models = _resolve_models(alias)
    if not models:
        raise ValueError(f"Unknown alias: {alias}")

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    last_error: Exception | None = None

    for _attempt in range(max_retries + 1):
        for model in models:
            if _is_in_cooldown(model):
                print(f"[LiteLLM] {model} in cooldown, skipping")
                continue

            api_key = _get_api_key(model)
            if not api_key:
                print(f"[LiteLLM] {model} skipped — API key not configured")
                continue

            try:
                kwargs = {
                    "model": model.replace("free-llm/", ""),
                    "messages": messages,
                    "temperature": 0.7,
                    "max_tokens": 2000,
                }

                if response_model:
                    kwargs["response_format"] = {"type": "json_object"}

                if model.startswith("free-llm/"):
                    kwargs["api_base"] = FREELLM_API_URL

                start = time.time()
                resp = completion(**kwargs)
                duration = time.time() - start

                text = resp["choices"][0]["message"]["content"].strip()
                tokens = resp.get("usage", {}).get("total_tokens", 0)
                print(f"[LiteLLM] {model} | {tokens} tokens | {duration:.0f}ms")

                if response_model:
                    cleaned = _extract_json(text)
                    parsed = json.loads(cleaned)
                    return response_model.model_validate(parsed)

                return text

            except Exception as e:
                last_error = e
                msg = str(e).lower()
                err_type = type(e).__name__.lower()

                # Don't retry Pydantic/validation errors
                if "validation" in err_type or "pydantic" in err_type:
                    raise
                if "429" in msg or "rate limit" in msg or "resource_exhausted" in msg or "quota" in msg:
                    print(f"[LiteLLM] {model} rate limited, entering cooldown")
                    _set_cooldown(model)
                    continue
                if "api key" in msg or "apikey" in msg or "api_key" in msg or "authentication" in msg or "authorization" in msg:
                    print(f"[LiteLLM] {model} skipped (auth error), trying next")
                    continue
                print(f"[LiteLLM] {model} failed: {e}")
                break

    raise RuntimeError(f'LiteLLM: all models failed for alias "{alias}": {last_error}')
