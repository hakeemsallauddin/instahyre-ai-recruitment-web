import { saveAs } from 'file-saver';
import Papa from 'papaparse';

const sanitizeCell = (value) =>
  typeof value === "string"
    ? value.replace(/(\r\n|\n|\r)/gm, " ").replace(/,/g, " ").replace(/"/g, "")
    : value;

const exportToCSV = (candidates) => {
  const data = candidates.map(c => {
    const feedback = c.conversation_transcript?.feedback || {};
    const rating = feedback.rating || {};

    const values = Object.values(rating).filter(val => typeof val === "number");
    const overallScore = values.length > 0
      ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
      : "";

    return {
      Name: sanitizeCell(c.fullname || c.userName || ""),
      Email: sanitizeCell(c.email || c.userEmail || ""),
      Score: overallScore,
      TechnicalSkills: rating.TechnicalSkills ?? rating.technicalSkills ?? "",
      Communication: rating.Communication ?? rating.communication ?? "",
      ProblemSolving: rating.ProblemSolving ?? rating.problemSolving ?? "",
      Experience: rating.Experience ?? rating.experience ?? "",
      Behavioral: rating.Behavioral ?? rating.behavioral ?? "",
      Recommendation: sanitizeCell(feedback.Recommendation || ''),
      RecommendationMessage: sanitizeCell(feedback.RecommendationMessage || '')
    };
  });

  // Debug: see export data
  console.log("Exporting to CSV:", data);

  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  saveAs(blob, "candidates.csv");
};

export default exportToCSV;
