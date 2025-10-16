import React, { useState, useEffect } from 'react';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

interface RevenueSummary {
  name: string;
  revenue: number;
}

function TotalRevenue() {
  const [summary, setSummary] = useState<RevenueSummary[]>([]);

  useEffect(() => {
    fetch('http://localhost:8000/revenue/summary')
      .then(response => response.json())
      .then(data => setSummary(data))
      .catch(error => console.error('Error fetching revenue summary:', error));
  }, []);

  const chartData = {
    labels: summary.map(s => s.name),
    datasets: [
      {
        data: summary.map(s => s.revenue),
        backgroundColor: [
          'rgba(255, 99, 132, 0.6)',
          'rgba(54, 162, 235, 0.6)',
          'rgba(255, 206, 86, 0.6)',
          'rgba(75, 192, 192, 0.6)',
          'rgba(153, 102, 255, 0.6)',
          'rgba(255, 159, 64, 0.6)',
        ],
      },
    ],
  };

  return (
    <div>
      <h2>Total Revenue</h2>
      <div style={{ width: '600px', margin: 'auto' }}>
        <Pie data={chartData} />
      </div>
    </div>
  );
}

export default TotalRevenue;
