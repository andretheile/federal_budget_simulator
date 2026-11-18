from typing import Dict, Any, List
from .model_card import ModelCard

class StandardModel:
    def calculate(self, params: Dict[str, Any]) -> Any:
        raise NotImplementedError

class ProgressiveTaxModel(StandardModel):
    def calculate(self, params: Dict[str, Any]) -> Dict[str, Any]:
        tax_brackets = params.get('tax_brackets', [])
        salary_distribution = params.get('salary_distribution', {})
        
        if not tax_brackets or not salary_distribution:
            return {"total_revenue": 0, "revenue_by_bracket": [], "effective_rate": 0}

        total_revenue = 0
        revenue_by_bracket = [0] * len(tax_brackets)
        total_income = 0
        
        # Sort brackets by min_income descending
        sorted_brackets_with_indices = sorted(enumerate(tax_brackets), key=lambda x: x[1]['min_income'], reverse=True)

        # Create a representative sample of salaries from the distribution
        # Assuming salary_distribution has a 'distribution' key with list of buckets
        # Each bucket: {'min_salary': float, 'percentage': float}
        salaries = []
        for bucket in salary_distribution.get('distribution', []):
            num_people = int(bucket['percentage'] * 10000) # Sample size 10,000
            for _ in range(num_people):
                salaries.append(bucket['min_salary'])

        for salary in salaries:
            total_income += salary
            taxable_income = salary
            
            for original_index, bracket in sorted_brackets_with_indices:
                if taxable_income > bracket['min_income']:
                    income_in_bracket = taxable_income - bracket['min_income']
                    tax_amount = income_in_bracket * bracket['rate']
                    
                    revenue_by_bracket[original_index] += tax_amount
                    total_revenue += tax_amount
                    
                    taxable_income = bracket['min_income']
                    
        effective_rate = total_revenue / total_income if total_income > 0 else 0
        
        return {
            "total_revenue": total_revenue,
            "revenue_by_bracket": revenue_by_bracket,
            "effective_rate": effective_rate
        }

class FlatTaxModel(StandardModel):
    def calculate(self, params: Dict[str, Any]) -> float:
        rate = params.get('rate', 0.0)
        base = params.get('base', 0.0)
        return base * rate

class FixedCostModel(StandardModel):
    def calculate(self, params: Dict[str, Any]) -> float:
        return params.get('amount', 0.0)

class PerCapitaModel(StandardModel):
    def calculate(self, params: Dict[str, Any]) -> float:
        per_capita_cost = params.get('per_capita_cost', 0.0)
        population = params.get('population', 0)
        return per_capita_cost * population

STANDARD_MODELS = {
    'progressive_tax': ProgressiveTaxModel,
    'flat_tax': FlatTaxModel,
    'fixed_cost': FixedCostModel,
    'per_capita': PerCapitaModel,
}

def get_standard_model(model_type: str) -> StandardModel:
    return STANDARD_MODELS.get(model_type)()
