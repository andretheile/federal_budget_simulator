import React, { useState, useEffect } from 'react';
import { TreemapController, TreemapElement } from 'chartjs-chart-treemap';
import { Chart as ChartJS, Tooltip, Legend } from 'chart.js';
import { Chart } from 'react-chartjs-2';

ChartJS.register(TreemapController, TreemapElement, Tooltip, Legend);

function TotalExpenditure() {
  const [chartData, setChartData] = useState<any>(null);

  useEffect(() => {
    fetch('http://localhost:8000/expenditure/hierarchy')
      .then(response => response.json())
      .then(data => {
        const chartData = {
          datasets: [
            {
              tree: data,
              key: 'value',
              groups: ['name'],
              backgroundColor: (ctx: any) => {
                const colors = [
                  'rgba(255, 99, 132, 0.6)',
                  'rgba(54, 162, 235, 0.6)',
                  'rgba(255, 206, 86, 0.6)',
                  'rgba(75, 192, 192, 0.6)',
                  'rgba(153, 102, 255, 0.6)',
                  'rgba(255, 159, 64, 0.6)',
                ];
                if (ctx.type !== 'dataset') {
                  return 'transparent';
                }
                const index = ctx.dataIndex % colors.length;
                return colors[index];
              },
            },
          ],
        };
        setChartData(chartData);
      })
      .catch(error => console.error('Error fetching expenditure hierarchy:', error));
  }, []);

  return (
    <div>
      <h2>Total Expenditure</h2>
      <div style={{ width: '800px', margin: 'auto' }}>
        {chartData && <Chart type="treemap" data={chartData} />}
      </div>
    </div>
  );
}

export default TotalExpenditure;
