import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Pool } from "pg";

function storageRoot() {
  return resolve(process.env.STORAGE_DIR || "../../storage");
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk) => { error += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code}: ${error.slice(0, 1000)}`));
    });
  });
}

function pageNumber(fileName: string) {
  const match = fileName.match(/-(\d+)\.png$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export async function processPdfOutbox(pool: Pool) {
  const rows = await pool.query<any>(
    `SELECT id,payload
     FROM outbox_events
     WHERE status IN ('PENDING','FAILED')
       AND available_at<=now()
       AND event_type='FILE_PROCESS_PDF'
     ORDER BY created_at
     LIMIT 5`,
  );
  let processed = 0;

  for (const event of rows.rows) {
    const claim = await pool.query(
      `UPDATE outbox_events
       SET status='PROCESSING',attempts=attempts+1
       WHERE id=$1 AND status IN ('PENDING','FAILED')
       RETURNING id,attempts`,
      [event.id],
    );
    if (!claim.rowCount) continue;

    const assetId = event.payload?.assetId;
    const storageKey = event.payload?.storageKey;
    if (!assetId || !storageKey) {
      await pool.query(`UPDATE outbox_events SET status='FAILED' WHERE id=$1`, [event.id]);
      continue;
    }

    const root = storageRoot();
    const workDir = resolve(root, `.pdf-work-${assetId}`);
    try {
      await mkdir(root, { recursive: true });
      await rm(workDir, { recursive: true, force: true });
      await mkdir(workDir, { recursive: true });
      await pool.query(`UPDATE assets SET status='PROCESSING',processing_error=NULL WHERE id=$1`, [assetId]);

      const sourcePath = resolve(root, storageKey);
      const prefix = resolve(workDir, "page");
      await run("pdftoppm", ["-png", "-r", "144", sourcePath, prefix]);
      const files = (await readdir(workDir)).filter((name) => /^page-\d+\.png$/i.test(name)).sort((a, b) => pageNumber(a) - pageNumber(b));
      if (!files.length) throw new Error("PDF processor returned no pages");

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const oldPages = await client.query<{ page_asset_id: string }>(`SELECT page_asset_id FROM pdf_processed_pages WHERE source_asset_id=$1`, [assetId]);
        await client.query(`DELETE FROM pdf_processed_pages WHERE source_asset_id=$1`, [assetId]);
        if (oldPages.rows.length) {
          await client.query(`UPDATE assets SET status='ARCHIVED' WHERE id=ANY($1::uuid[])`, [oldPages.rows.map((row) => row.page_asset_id)]);
        }

        for (let index = 0; index < files.length; index += 1) {
          const file = files[index]!;
          const sourcePagePath = resolve(workDir, file);
          const outputKey = `${randomUUID()}.png`;
          const outputPath = resolve(root, outputKey);
          await copyFile(sourcePagePath, outputPath);
          const buffer = await readFile(outputPath);
          const fileStat = await stat(outputPath);
          const checksum = createHash("sha256").update(buffer).digest("hex");
          const pageAsset = await client.query<{ id: string }>(
            `INSERT INTO assets(type,status,storage_key,original_filename,mime_type,size_bytes,checksum)
             VALUES('PDF_PAGE','READY',$1,$2,'image/png',$3,$4)
             RETURNING id`,
            [outputKey, `${basename(storageKey)}-page-${index + 1}.png`, fileStat.size, checksum],
          );
          await client.query(
            `INSERT INTO pdf_processed_pages(source_asset_id,page_number,page_asset_id)
             VALUES($1,$2,$3)`,
            [assetId, index + 1, pageAsset.rows[0]!.id],
          );
        }
        await client.query(`UPDATE assets SET status='READY',processing_error=NULL WHERE id=$1`, [assetId]);
        await client.query(`UPDATE outbox_events SET status='PROCESSED',processed_at=now() WHERE id=$1`, [event.id]);
        await client.query("COMMIT");
        processed += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = Number((claim.rows[0] as any)?.attempts ?? 1);
      await pool.query(`UPDATE assets SET status='FAILED',processing_error=$2 WHERE id=$1`, [assetId, message.slice(0, 2000)]);
      await pool.query(
        `UPDATE outbox_events
         SET status='FAILED',available_at=now()+($2::text||' seconds')::interval
         WHERE id=$1`,
        [event.id, Math.min(3600, 60 * 2 ** Math.max(0, attempts - 1))],
      );
      console.error("PDF processing failed", { assetId, error: message });
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return processed;
}
