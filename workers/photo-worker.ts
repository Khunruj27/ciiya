console.log("Photo worker started")

setInterval(async () => {
  try {
    console.log("[Worker] polling...")

    // TODO:
    // เรียก API process photos
    // queue processing
    // resize image
    // face embedding
  } catch (err) {
    console.error("[Worker Error]", err)
  }
}, 3000)