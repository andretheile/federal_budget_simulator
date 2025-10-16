import React, { useState, useEffect } from 'react';

function BalanceSheet() {
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalExpenditure, setTotalExpenditure] = useState(0);

  useEffect(() => {
    fetch('http://localhost:8000/revenue/summary')
      .then(response => response.json())
      .then(data => {
        const total = data.reduce((acc: number, item: any) => acc + item.revenue, 0);
        setTotalRevenue(total);
      })
      .catch(error => console.error('Error fetching revenue summary:', error));

    fetch('http://localhost:8000/expenditure/summary')
      .then(response => response.json())
      .then(data => {
        const total = data.reduce((acc: number, item: any) => acc + item.expenditure, 0);
        setTotalExpenditure(total);
      })
      .catch(error => console.error('Error fetching expenditure summary:', error));
  }, []);

  const surplus = totalRevenue - totalExpenditure;

  return (
    <div>
      <h2>Balance Sheet</h2>
      <div>
        <h3>Total Revenue: {totalRevenue.toLocaleString()}</h3>
        <h3>Total Expenditure: {totalExpenditure.toLocaleString()}</h3>
        <hr />
        <h3>Surplus / Deficit: {surplus.toLocaleString()}</h3>
      </div>
    </div>
  );
}

export default BalanceSheet;
