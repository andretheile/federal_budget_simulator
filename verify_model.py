from backend.models.dynamic_model import load_model_from_card
import os

# Ensure we are in the root directory
if not os.path.exists('backend'):
    print("Error: Please run this script from the project root directory.")
    exit(1)

print("Loading model...")
DynamicIncomeTax, income_tax_card = load_model_from_card('backend/model_cards/income_tax.yaml')

print("Initializing model...")
# Default parameters
params = {
    'tax_brackets': [
        {'rate': 0.1, 'min_income': 0},
        {'rate': 0.2, 'min_income': 20000},
        {'rate': 0.3, 'min_income': 50000},
        {'rate': 0.4, 'min_income': 100000}
    ]
}
model = DynamicIncomeTax(**params)

print("Calculating...")
result = model.calculate()

print("\nResult:")
print(f"Total Revenue: {result['total_revenue']}")
print(f"Revenue by Bracket: {result['revenue_by_bracket']}")
print(f"Effective Rate: {result['effective_rate']}")

# Basic assertions
assert result['total_revenue'] > 0
assert len(result['revenue_by_bracket']) == 4
assert 0 < result['effective_rate'] < 1

print("\nVerification successful!")
