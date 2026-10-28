# SPDX-License-Identifier: Apache-2.0
import sys
from pathlib import Path

SPACE = Path(__file__).resolve().parents[1]
if str(SPACE) not in sys.path:
    sys.path.insert(0, str(SPACE))
