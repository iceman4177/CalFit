// src/CalorieHistory.jsx
import React, { useEffect, useState } from 'react';
import {
  Container,
  Typography,
  Button,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Box
} from '@mui/material';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable'; // import the standalone function

function exportToCsv(rows, filename) {
  const header = Object.keys(rows[0]).join(',');
  const csv = [
    header,
    ...rows.map(r => Object.values(r).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function CalorieHistory() {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const meals    = JSON.parse(localStorage.getItem('mealHistory')   || '[]');
    const map = {};

    workouts.forEach(w => {
      const key = w.date;
      map[key] = map[key] || { date: key, burned: 0, consumed: 0 };
      map[key].burned += w.totalCalories;
    });
    meals.forEach(m => {
      const key = m.date;
      map[key] = map[key] || { date: key, burned: 0, consumed: 0 };
      map[key].consumed += m.meals.reduce((sum, e) => sum + e.calories, 0);
    });

    const combined = Object.values(map)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map(r => ({
        Date:     r.date,
        Burned:   r.burned.toFixed(2),
        Consumed: r.consumed.toFixed(2),
        Net:      (r.consumed - r.burned).toFixed(2)
      }));

    setHistory(combined);
  }, []);

  const handleExportCsv = () => {
    if (!history.length) return;
    exportToCsv(history, 'slimcal_history.csv');
  };

  const handleExportPdf = () => {
    if (!history.length) return;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('Slimcal.ai Calorie History', 14, 22);
    doc.setFontSize(11);
    const totalDays = history.length;
    const avgNet = (
      history.reduce((sum, r) => sum + parseFloat(r.Net), 0) /
      totalDays
    ).toFixed(2);
    doc.text(`Days: ${totalDays}  |  Avg Net: ${avgNet} kcal`, 14, 30);

    // use the standalone autoTable function
    autoTable(doc, {
      startY: 36,
      head: [['Date', 'Burned', 'Consumed', 'Net']],
      body: history.map(r => [r.Date, r.Burned, r.Consumed, r.Net]),
      styles: { fontSize: 10 }
    });

    doc.save('slimcal_history.pdf');
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" align="center" gutterBottom>
        Calorie History
      </Typography>
      <Box sx={{ mb: 2, display: 'flex', gap: 2, justifyContent: 'center' }}>
        <Button
          variant="outlined"
          onClick={handleExportCsv}
          disabled={!history.length}
        >
          Export CSV
        </Button>
        <Button
          variant="contained"
          onClick={handleExportPdf}
          disabled={!history.length}
        >
          Download PDF
        </Button>
      </Box>

      {history.length === 0 ? (
        <Typography>No history data to show.</Typography>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell align="right">Burned</TableCell>
              <TableCell align="right">Consumed</TableCell>
              <TableCell align="right">Net</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {history.map((row, idx) => (
              <TableRow key={idx}>
                <TableCell>{row.Date}</TableCell>
                <TableCell align="right">{row.Burned}</TableCell>
                <TableCell align="right">{row.Consumed}</TableCell>
                <TableCell align="right">{row.Net}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Container>
  );
}
