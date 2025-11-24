import fs from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "commit-history.json");
// Ruta relativa usada en comandos git para excluir el archivo
const GIT_EXCLUDE_PATH = "script/commit-history.json";

function getCommitInfo(sha) {
  let commitMessage, commitDate, author;
  const gitSha = sha;

  try {
    commitMessage = execSync(`git log -1 --pretty=%B ${gitSha}`)
      .toString()
      .trim();
    commitDate = new Date(
      execSync(`git log -1 --format=%cd ${gitSha}`).toString()
    ).toISOString();
    author = execSync(`git log -1 --pretty=format:%an ${gitSha}`)
      .toString()
      .trim();
  } catch (error) {
    console.error(`Error al obtener información del commit ${gitSha}:`, error);
    return null;
  }

  let repoUrl = "";
  try {
    repoUrl = execSync("git config --get remote.origin.url")
      .toString()
      .trim()
      .replace(/\.git$/, "");
    if (repoUrl.startsWith("git@")) {
      repoUrl = repoUrl.replace(/^git@([^:]+):(.+)$/, "https://$1/$2");
    }
  } catch {
    console.warn("No se encontró un repositorio remoto.");
  }

  let additions = 0,
    deletions = 0;

  try {
    // Obtener el parent del commit actual para comparar
    let parentRef;
    try {
      const parents = execSync(`git log -1 --pretty=%P ${gitSha}`)
        .toString()
        .trim();
      if (parents) {
        parentRef = parents.split(" ")[0];
      } else {
        parentRef = null;
      }
    } catch (error) {
      parentRef = null;
    }

    try {
      // Usar --numstat para obtener números fiables de adiciones/eliminaciones
      if (parentRef) {
        const diffOutput = execSync(
          `git diff --numstat ${parentRef} ${gitSha} -- ":!${GIT_EXCLUDE_PATH}"`
        )
          .toString()
          .trim();
        if (diffOutput) {
          const lines = diffOutput.split(/\r?\n/);
          for (const line of lines) {
            const parts = line.split(/\t+/);
            if (parts.length >= 2) {
              const a = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
              const d = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
              additions += a;
              deletions += d;
            }
          }
        }
      } else {
        // Primer commit: usar git show --numstat
        const showOutput = execSync(
          `git show --numstat ${gitSha} -- ":!${GIT_EXCLUDE_PATH}"`
        )
          .toString()
          .trim();
        if (showOutput) {
          const lines = showOutput.split(/\r?\n/);
          for (const line of lines) {
            const parts = line.split(/\t+/);
            if (parts.length >= 2 && /^\d/.test(parts[0])) {
              const a = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
              const d = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
              additions += a;
              deletions += d;
            }
          }
        }
      }
    } catch (error) {
      console.warn(
        `Error al obtener estadísticas del diff para ${gitSha}:`,
        error.message
      );
    }
  } catch (error) {
    console.warn(
      `Error general al calcular estadísticas para ${gitSha}:`,
      error.message
    );
  }

  let testCount = 0,
    coverage = 0,
    failedTests = 0;

  let conclusion = "neutral"; // valor por defecto

  if (fs.existsSync(path.join(__dirname, "..", "package.json")) || fs.existsSync(path.join(__dirname, "..", "src"))) {
    const tempDir = tmpdir();
    const randomId = crypto.randomBytes(8).toString("hex");
    const outputPath = path.join(tempDir, `jest-results-${randomId}.json`);

    try {
      try {
        execSync(
          `npx jest --coverage --json --outputFile=${outputPath} --passWithNoTests`,
          {
            stdio: "pipe",
          }
        );
      } catch (jestError) {
        // jest puede devolver código de salida distinto a 0 si hay fallos, pero aún así producirá el archivo
      }

      // Procesar los resultados si el archivo existe
      if (fs.existsSync(outputPath)) {
        const jestResults = JSON.parse(fs.readFileSync(outputPath, "utf8"));
        testCount = jestResults.numTotalTests || 0;
        failedTests = jestResults.numFailedTests || 0;

        // Calcular cobertura si existe
        if (jestResults.coverageMap) {
          const coverageMap = jestResults.coverageMap;
          let covered = 0,
            total = 0;

          for (const file of Object.values(coverageMap)) {
            const s = file.s;
            const fileTotal = Object.keys(s).length;
            const fileCovered = Object.values(s).filter((v) => v > 0).length;
            total += fileTotal;
            covered += fileCovered;
          }

          if (total > 0) {
            coverage = (covered / total) * 100;
            coverage = Math.round(coverage * 100) / 100;
          }
        }

        // Establecer conclusión según pruebas
        if (testCount > 0) {
          conclusion = failedTests > 0 ? "failure" : "success";
        }

        // Limpieza del archivo temporal
        try {
          fs.unlinkSync(outputPath);
        } catch (unlinkError) {
          console.warn(
            `No se pudo eliminar el archivo temporal: ${unlinkError.message}`
          );
        }
      } else {
        console.warn("El archivo de resultados de Jest no fue creado");
      }
    } catch (error) {
      console.warn("Error al procesar resultados de pruebas:", error.message);
    }
  }

  return {
    sha: sha,
    author,
    commit: {
      date: commitDate,
      message: commitMessage,
      url: repoUrl ? `${repoUrl}/commit/${sha}` : undefined,
    },
    stats: {
      total: additions + deletions,
      additions,
      deletions,
      date: commitDate.split("T")[0],
    },
    coverage,
    test_count: testCount,
    failed_tests: failedTests,
    conclusion,
  };
}

function saveCommitData(commitData) {
  let commits = [];
  if (fs.existsSync(DATA_FILE)) {
    try {
      commits = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch (error) {
      console.error("Error al leer el archivo de datos:", error);
      commits = [];
    }
  }

  if (!commitData || !commitData.sha) return;

  // Actualizar si existe el mismo SHA, sino agregar
  const existingIndex = commits.findIndex((c) => c.sha === commitData.sha);
  if (existingIndex >= 0) {
    commits[existingIndex] = commitData;
  } else {
    commits.push(commitData);
  }

  // Actualizar URLs para commits que no la tengan si tenemos una URL base
  if (commitData.commit && commitData.commit.url) {
    const baseUrl = commitData.commit.url.split("/commit/")[0];
    commits.forEach((commit) => {
      if ((!commit.commit || !commit.commit.url) && commit.sha) {
        if (!commit.commit) commit.commit = {};
        commit.commit.url = `${baseUrl}/commit/${commit.sha}`;
      }
    });
  }

  // Ordenar commits por fecha ascendente (más reciente al final)
  commits.sort((a, b) => new Date(a.commit.date) - new Date(b.commit.date));

  fs.writeFileSync(DATA_FILE, JSON.stringify(commits, null, 2));
}

try {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
  }

  // Obtener SHA real del HEAD actual
  const currentSha = execSync("git rev-parse HEAD").toString().trim();
  const currentCommitData = getCommitInfo(currentSha);
  if (currentCommitData) {
    saveCommitData(currentCommitData);
  }
} catch (error) {
  console.error("Error en el script de seguimiento de commits:", error);
  process.exit(1);
}
