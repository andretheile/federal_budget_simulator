import unittest
from backend.models.standard_models import ProgressiveTaxModel, FlatTaxModel, FixedCostModel, PerCapitaModel

class TestStandardModels(unittest.TestCase):
    def test_progressive_tax_model(self):
        model = ProgressiveTaxModel()
        params = {
            "tax_brackets": [
                {"rate": 0.1, "min_income": 0},
                {"rate": 0.2, "min_income": 10000}
            ],
            "salary_distribution": {
                "distribution": [
                    {"min_salary": 5000, "percentage": 0.5},
                    {"min_salary": 20000, "percentage": 0.5}
                ]
            }
        }
        # 5000 income: 5000 * 0.1 = 500 tax. 5000 people -> 2,500,000
        # 20000 income: (10000 * 0.1) + (10000 * 0.2) = 1000 + 2000 = 3000 tax. 5000 people -> 15,000,000
        # Total revenue: 17,500,000
        
        result = model.calculate(params)
        self.assertEqual(result["total_revenue"], 17500000)
        self.assertEqual(len(result["revenue_by_bracket"]), 2)

    def test_flat_tax_model(self):
        model = FlatTaxModel()
        params = {"rate": 0.1, "base": 100000}
        self.assertEqual(model.calculate(params), 10000.0)

    def test_fixed_cost_model(self):
        model = FixedCostModel()
        params = {"amount": 50000}
        self.assertEqual(model.calculate(params), 50000)

    def test_per_capita_model(self):
        model = PerCapitaModel()
        params = {"per_capita_cost": 100, "population": 1000}
        self.assertEqual(model.calculate(params), 100000)

if __name__ == '__main__':
    unittest.main()
