type Model = { isLoaded: boolean; loadFromUri: (uri: string) => Promise<unknown> }

// Wait for every in-flight load before reporting a failure, so a retry cannot
// race a still-loading model. Successfully loaded models are reused on retry.
export async function loadModelsInParallel(models: Model[], uri: string, onLoaded?: () => void) {
  const results = await Promise.allSettled(models.map(async (model) => {
    if (!model.isLoaded) await model.loadFromUri(uri)
    onLoaded?.()
  }))
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}
