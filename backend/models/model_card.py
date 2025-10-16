from pydantic import BaseModel
from typing import List, Dict, Any

class ModelParameter(BaseModel):
    name: str
    type: str
    default: Any

class ModelCard(BaseModel):
    name: str
    description: str
    model_type: str
    parameters: List[ModelParameter] = []
    sub_models: List[str] = []
    data_sources: Dict[str, str] = {}
    calculation_logic: str
