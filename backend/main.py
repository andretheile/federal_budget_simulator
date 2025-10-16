from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .models.dynamic_model import load_model_from_card, find_model_cards
from pydantic import BaseModel
from typing import List, Dict, Any

app = FastAPI()

origins = [
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the income tax model from the model card
DynamicIncomeTax, income_tax_card = load_model_from_card('backend/model_cards/income_tax.yaml')

class CalculationRequest(BaseModel):
    parameters: Dict[str, Any]

@app.get("/")
def read_root():
    return {"message": "Welcome to the Federal Budget Simulator API"}

@app.get("/income-tax")
def get_income_tax():
    return income_tax_card.dict()

@app.post("/income-tax/calculate")
def calculate_income_tax(request: CalculationRequest):
    print("Received calculation request:", request.parameters)
    income_tax = DynamicIncomeTax(**request.parameters['parameters'])
    revenue = income_tax.calculate()
    print("Calculated revenue:", revenue)
    return {"revenue": revenue}

@app.get("/revenue/summary")
def get_revenue_summary():
    summary = []
    for card_path in find_model_cards('backend/model_cards'):
        DynamicModel, model_card = load_model_from_card(card_path)
        if model_card.model_type == 'income_stream':
            model = DynamicModel()
            summary.append({"name": model_card.name, "revenue": model.calculate()})
    return summary

@app.get("/expenditure/summary")
def get_expenditure_summary():
    summary = []
    for card_path in find_model_cards('backend/model_cards'):
        DynamicModel, model_card = load_model_from_card(card_path)
        if model_card.model_type == 'expenditure':
            model = DynamicModel()
            summary.append({"name": model_card.name, "expenditure": model.calculate()})
    return summary

def get_model_hierarchy(card_path: str):
    DynamicModel, model_card = load_model_from_card(card_path)
    model = DynamicModel()
    data = {
        "name": model_card.name,
        "value": model.calculate(),
    }
    if model_card.sub_models:
        data["children"] = [get_model_hierarchy(sub_model_path) for sub_model_path in model_card.sub_models]
    return data

@app.get("/expenditure/hierarchy")
def get_expenditure_hierarchy():
    hierarchy = []
    for card_path in find_model_cards('backend/model_cards/expenditures'):
        # We only want to get the top-level expenditure models
        if len(card_path.split('/')) == 4:
            hierarchy.append(get_model_hierarchy(card_path))
    return hierarchy
