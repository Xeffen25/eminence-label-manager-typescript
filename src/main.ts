import * as core from '@actions/core'
import * as github from '@actions/github'
import * as fs from 'fs'
import * as path from 'path'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // 1. Retrieve inputs defined in action.yml
    const token = core.getInput('token')
    const mode = core.getInput('mode') || 'update'
    const manifest = core.getInput('manifest') || '.github/labels.json'

    // 2. Initialize github client
    const octokit = github.getOctokit(token)
    const { owner, repo } = github.context.repo

    // 3. Parse manifest file
    const manifestPath = path.resolve(manifest)
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest file not found at path: ${manifestPath}`)
    }

    const fileContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

    if (!Array.isArray(fileContent)) {
      throw new Error(
        `Manifest file is not properly formatted. It should be an array of label objects.`
      )
    }

    // 4. Create a Map of the file labels for easy lookup
    const fileLabelsMap = new Map<
      string,
      { color: string; description?: string }
    >()

    for (const label of fileContent) {
      // Validate label structure
      if (!label.name || !label.color) {
        throw new Error(`Each label must have at least a name and a color.`)
      }
      // Add label to the map
      fileLabelsMap.set(label.name, {
        color: label.color,
        description: label.description || ''
      })
    }

    // 5. Cycle through existing labels in the repository and apply changes based on mode
    if (mode !== 'add') {
      const iterator = octokit.paginate.iterator(
        octokit.rest.issues.listLabelsForRepo,
        {
          owner,
          repo,
          per_page: 100
        }
      )
      for await (const { data: labels } of iterator) {
        for (const label of labels) {
          // Do what's needed based on the mode to the existing labels of the repository
          if (mode === 'update') {
            if (fileLabelsMap.has(label.name)) {
              const fileLabel = fileLabelsMap.get(label.name)!
              // Update the label if color or description differ
              if (
                label.color !== fileLabel.color ||
                (label.description || '') !== (fileLabel.description || '')
              ) {
                await octokit.rest.issues.updateLabel({
                  owner,
                  repo,
                  name: label.name,
                  color: fileLabel.color,
                  description: fileLabel.description
                })
                core.debug(`Label "${label.name}" has been updated.`)
              } else {
                core.debug(`Label "${label.name}" is already up to date.`)
              }
              // Remove the label from the map to keep track of processed labels
              fileLabelsMap.delete(label.name)
            }
          } else {
            // mode === 'delete'
            await octokit.rest.issues.deleteLabel({
              owner,
              repo,
              name: label.name
            })
          }
        }
      }
    }
    // 6. Add new labels from the file that do not exist in the repository
    for (const [name, label] of fileLabelsMap) {
      await octokit.rest.issues.createLabel({
        owner,
        repo,
        name,
        color: label.color,
        description: label.description
      })
      core.debug(`Label "${name}" has been created.`)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}
