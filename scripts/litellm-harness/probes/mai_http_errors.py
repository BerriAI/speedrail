"""Post-comparison diagnostic probe, not part of the frozen acceptance score.

The task requires HTTP 400 for invalid inputs. The original reference tests also
require one exception subclass and exact phrases. This probe checks the stated
status-code contract without prescribing those implementation details.
"""
import pytest

import litellm
from litellm.llms.azure_ai.image_generation import AzureFoundryMAIImageGenerationConfig
from litellm.utils import get_optional_params_image_gen


@pytest.mark.parametrize("size", ["auto", "1024xabc", "512x512", "256x256", "700x1400", "1792x1024", "1024x1792", "1033x1024"])
def test_invalid_size_is_http_400(size):
    with pytest.raises(Exception) as error:
        AzureFoundryMAIImageGenerationConfig().map_openai_params(
            non_default_params={"size": size}, optional_params={},
            model="MAI-Image-2.5", drop_params=True,
        )
    assert getattr(error.value, "status_code", None) == 400


@pytest.mark.parametrize("n", [2, 4, "2", 0, -1, "abc"])
def test_invalid_count_is_http_400(n):
    with pytest.raises(Exception) as error:
        AzureFoundryMAIImageGenerationConfig().map_openai_params(
            non_default_params={"n": n}, optional_params={},
            model="MAI-Image-2.5", drop_params=False,
        )
    assert getattr(error.value, "status_code", None) == 400


def test_invalid_count_through_shared_mapping_is_http_400(monkeypatch):
    monkeypatch.setattr(litellm, "drop_params", False)
    with pytest.raises(Exception) as error:
        get_optional_params_image_gen(
            model="MAI-Image-2.5", n=4, custom_llm_provider="azure_ai",
            provider_config=AzureFoundryMAIImageGenerationConfig(),
        )
    assert getattr(error.value, "status_code", None) == 400
