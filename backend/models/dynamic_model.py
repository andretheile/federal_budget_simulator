import yaml
import os
import json
from asteval import Interpreter
from .model_card import ModelCard

def find_model_cards(card_dir: str) -> list[str]:
    """Finds all model card YAML files in a directory and its subdirectories."""
    card_paths = []
    for root, _, files in os.walk(card_dir):
        for f in files:
            if f.endswith('.yaml'):
                card_paths.append(os.path.join(root, f))
    return card_paths

def load_model_from_card(card_path: str):
    """Loads a model from a YAML model card."""
    with open(card_path, 'r') as f:
        card_data = yaml.safe_load(f)
    
    model_card = ModelCard(**card_data)

    class DynamicModel:
        def __init__(self, **kwargs):
            self.params = {}
            for param in model_card.parameters:
                self.params[param.name] = kwargs.get(param.name, param.default)

            for name, path in model_card.data_sources.items():
                with open(path, 'r') as f:
                    self.params[name] = json.load(f)

            self.sub_models = []
            for sub_model_path in model_card.sub_models:
                SubModel, _ = load_model_from_card(sub_model_path)
                self.sub_models.append(SubModel())
            
            if self.sub_models:
                self.params['sub_models'] = self.sub_models

        def calculate(self):
            aeval = Interpreter(symtable=self.params)
            return aeval.eval(model_card.calculation_logic)

    return DynamicModel, model_card
