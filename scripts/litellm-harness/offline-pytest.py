"""Run selected acceptance tests without repository conftest, credentials or network."""
import os
from pathlib import Path
import socket
import sys

workspace=Path(sys.argv[1]).resolve()
arguments=sys.argv[2:]
os.environ.clear()
os.environ.update({'PATH':'/usr/bin:/bin','LITELLM_LOCAL_MODEL_COST_MAP':'True','PYTHON_DOTENV_DISABLED':'1','HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1','DO_NOT_TRACK':'1'})
os.chdir(workspace)
sys.path.insert(0,str(workspace))
def blocked(*args,**kwargs):
    raise RuntimeError('Outbound network is disabled in the offline evaluation.')
socket.socket.connect=blocked
socket.socket.connect_ex=blocked
socket.create_connection=blocked
socket.getaddrinfo=blocked
import pytest
sys.exit(pytest.main(['-c','/dev/null','--noconftest','-p','no:cacheprovider','-p','pytest_asyncio.plugin','-p','pytest_mock','-p','respx.plugin','-q','--tb=short',*arguments]))
