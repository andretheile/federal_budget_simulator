import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import 'react-tabs/style/react-tabs.css';
import TotalRevenue from './components/TotalRevenue';
import TotalExpenditure from './components/TotalExpenditure';
import BalanceSheet from './components/BalanceSheet';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface ModelParameter {
  name: string;
  type: string;
  default: any;
}

interface ModelCard {
  name: string;
  description: string;
  model_type: string;
  parameters: ModelParameter[];
  calculation_logic: string;
}

function App() {
  const [modelCard, setModelCard] = useState<ModelCard | null>(null);
  const [revenue, setRevenue] = useState<number | null>(null);
  const [parameters, setParameters] = useState<any>({});

  useEffect(() => {
    fetch('http://localhost:8000/income-tax')
      .then(response => response.json())
      .then(data => {
        setModelCard(data);
        const initialParams: any = {};
        data.parameters.forEach((p: ModelParameter) => {
          initialParams[p.name] = p.default;
        });
        setParameters(initialParams);
      })
      .catch(error => console.error('Error fetching model card:', error));
  }, []);

  const calculateRevenue = useCallback(() => {
    if (!modelCard) return;
    console.log('Calculating revenue with parameters:', parameters);
    fetch('http://localhost:8000/income-tax/calculate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parameters }),
    })
      .then(response => response.json())
      .then(data => {
        console.log('Received revenue data:', data);
        setRevenue(data.revenue);
      })
      .catch(error => console.error('Error calculating revenue:', error));
  }, [modelCard, parameters]);

  useEffect(() => {
    calculateRevenue();
  }, [calculateRevenue]);

  const handleRateChange = (index: number, newRate: number) => {
    const newTaxBrackets = [...parameters.tax_brackets];
    newTaxBrackets[index].rate = newRate;
    setParameters({ ...parameters, tax_brackets: newTaxBrackets });
  };

  const chartData = {
    labels: parameters.tax_brackets?.map((b: any) => `> ${b.min_income}`),
    datasets: [
      {
        label: 'Tax Rate',
        data: parameters.tax_brackets?.map((b: any) => b.rate),
        backgroundColor: 'rgba(75, 192, 192, 0.6)',
      },
    ],
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Federal Budget Simulator</h1>
        <Tabs>
          <TabList>
            <Tab>Income Tax</Tab>
            <Tab>Total Revenue</Tab>
            <Tab>Expenditures</Tab>
            <Tab>Balance Sheet</Tab>
          </TabList>

          <TabPanel>
            {modelCard ? (
              <div>
                <h2>{modelCard.name}</h2>
                <p>{modelCard.description}</p>
                <h3>Calculated Revenue: {revenue ? revenue.toLocaleString() : 'Calculating...'}</h3>
                <h3>Tax Brackets</h3>
                {parameters.tax_brackets?.map((bracket: any, index: number) => (
                  <div key={index}>
                    <span>Rate for income &gt; {bracket.min_income}: </span>
                    <input
                      type="number"
                      step="0.01"
                      value={bracket.rate}
                      onChange={e => handleRateChange(index, parseFloat(e.target.value))}
                    />
                  </div>
                ))}
                <div style={{ width: '600px', margin: 'auto', marginTop: '20px' }}>
                  <Bar data={chartData} />
                </div>
              </div>
            ) : (
              <p>Loading model data...</p>
            )}
          </TabPanel>
          <TabPanel>
            <TotalRevenue />
          </TabPanel>
          <TabPanel>
            <TotalExpenditure />
          </TabPanel>
          <TabPanel>
            <BalanceSheet />
          </TabPanel>
        </Tabs>
      </header>
    </div>
  );
}

export default App;