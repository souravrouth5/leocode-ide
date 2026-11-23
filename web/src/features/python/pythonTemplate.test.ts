import { describe, expect, it, vi } from "vitest"
import { MockBridge } from "../../bridge/mock"
import {
  createPythonProjectTemplate,
  PYTHON_TEMPLATE_FILES,
  type BridgeClient
} from "./pythonTemplate"

describe("pythonTemplate", () => {
  it("defines standard template files with expected contents", () => {
    expect(Object.keys(PYTHON_TEMPLATE_FILES)).toEqual([
      "main.py",
      "requirements.txt",
      ".gitignore",
      "README.md"
    ])

    expect(PYTHON_TEMPLATE_FILES["main.py"]).toContain('def main():\n    print("Hello from LeoCode Python!")')
    expect(PYTHON_TEMPLATE_FILES["main.py"]).toContain('if __name__ == "__main__":\n    main()')
    expect(PYTHON_TEMPLATE_FILES["requirements.txt"]).toBe("# Add project dependencies here\n")
    expect(PYTHON_TEMPLATE_FILES[".gitignore"]).toBe("__pycache__/\n*.py[cod]\n.venv/\n")
    expect(PYTHON_TEMPLATE_FILES["README.md"]).toBe("# Python Project\n\nCreated with LeoCode.\n")
  })

  it("writes all 4 template files to workspace root using MockBridge", async () => {
    const bridge = new MockBridge()
    const createdPaths = await createPythonProjectTemplate(bridge)

    expect(createdPaths).toEqual([
      "main.py",
      "requirements.txt",
      ".gitignore",
      "README.md"
    ])

    for (const path of createdPaths) {
      const content = await bridge.read(path)
      expect(content).toBe(PYTHON_TEMPLATE_FILES[path])
    }
  })

  it("writes files into specified targetDir", async () => {
    const bridge = new MockBridge()
    const createdPaths = await createPythonProjectTemplate(bridge, "my_project")

    expect(createdPaths).toEqual([
      "my_project/main.py",
      "my_project/requirements.txt",
      "my_project/.gitignore",
      "my_project/README.md"
    ])

    for (const [name, content] of Object.entries(PYTHON_TEMPLATE_FILES)) {
      const readContent = await bridge.read(`my_project/${name}`)
      expect(readContent).toBe(content)
    }
  })

  it("handles targetDir with trailing slash", async () => {
    const bridge = new MockBridge()
    const createdPaths = await createPythonProjectTemplate(bridge, "pkg/")

    expect(createdPaths).toEqual([
      "pkg/main.py",
      "pkg/requirements.txt",
      "pkg/.gitignore",
      "pkg/README.md"
    ])
  })

  it("calls bridge.fs.write when provided", async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined)
    const customBridge: BridgeClient = {
      fs: {
        write: writeMock
      }
    }

    const created = await createPythonProjectTemplate(customBridge, "custom_dir")

    expect(created).toHaveLength(4)
    expect(writeMock).toHaveBeenCalledTimes(4)
    expect(writeMock).toHaveBeenCalledWith(
      "custom_dir/main.py",
      PYTHON_TEMPLATE_FILES["main.py"]
    )
    expect(writeMock).toHaveBeenCalledWith(
      "custom_dir/requirements.txt",
      PYTHON_TEMPLATE_FILES["requirements.txt"]
    )
  })

  it("throws error when bridge does not provide write or fs.write", async () => {
    const invalidBridge = {} as unknown as BridgeClient
    await expect(createPythonProjectTemplate(invalidBridge)).rejects.toThrow(
      "BridgeClient does not provide a write method"
    )
  })
})
