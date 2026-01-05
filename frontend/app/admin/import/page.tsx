import ImportForm from "./ImportForm";

export default async function ImportCsvPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ margin: 0 }}>Import CSV</h1>
      <p style={{ marginTop: 8 }}>
        Upload a CSV with headers: <code>experimentId</code>, <code>testName</code>,{" "}
        <code>vertical</code>, <code>geo</code>, <code>dateLaunched</code>,{" "}
        <code>dateConcluded</code>, <code>winningVar</code>.
      </p>
      <ImportForm />
    </main>
  );
}
