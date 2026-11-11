import CryptoKit
import Foundation

/// A fresh key for an agent, made on the phone so nobody has to find or paste one.
/// The secret leaves the phone only through the setup the user copies into the agent's app; it is never saved.
struct AgentKey: Sendable {
    let publicKey: String
    /// NEAR's `ed25519:<base58 of seed and public key>` form, which the fliq MCP server reads.
    let secretKey: String

    static func generate() -> AgentKey {
        let key = Curve25519.Signing.PrivateKey()
        let publicBytes = key.publicKey.rawRepresentation
        return AgentKey(
            publicKey: NEARKey.encode(publicBytes),
            secretKey: "ed25519:" + NEARKey.base58(key.rawRepresentation + publicBytes)
        )
    }

    /// A pasted public key, or nil when it is not a 32-byte `ed25519:` key.
    static func validPublicKey(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return NEARKey.decode(trimmed) == nil ? nil : trimmed
    }
}

/// What the user pastes into the agent's app to give it the key and the vault.
struct AgentSetup: Equatable, Sendable {
    let app: AgentApp
    let accountId: String
    let secretKey: String
    let rpcURL: String
    let vault: String

    static let apiKeyPlaceholder = "<your fliq API key>"
    static var bundledRPC: String {
        Bundle.main.object(forInfoDictionaryKey: "FliqNearRPCURL") as? String ?? "https://rpc.testnet.near.org"
    }

    private var environment: [(String, String)] {
        [
            ("FLIQ_API_KEY", Self.apiKeyPlaceholder),
            ("FLIQ_AGENT_ACCOUNT_ID", accountId),
            ("FLIQ_AGENT_PRIVATE_KEY", secretKey),
            ("FLIQ_NEAR_RPC_URL", rpcURL),
            ("FLIQ_VAULT_CONTRACT_ID", vault),
        ]
    }

    /// Where the snippet goes, in the app's own words.
    var destination: String {
        switch app {
        case .claude: "Run this in a terminal"
        case .openai: "Add this to ~/.codex/config.toml"
        case .cursor: "Add this to .cursor/mcp.json"
        case .other: "Add this to your agent's MCP settings"
        }
    }

    var snippet: String {
        switch app {
        case .claude:
            let flags = environment.map { "  --env \($0.0)=\($0.1) \\" }.joined(separator: "\n")
            return "claude mcp add fliq \\\n\(flags)\n  -- npx -y @fliq/mcp"
        case .openai:
            let env = environment.map { "\($0.0) = \"\($0.1)\"" }.joined(separator: ", ")
            return "[mcp_servers.fliq]\ncommand = \"npx\"\nargs = [\"-y\", \"@fliq/mcp\"]\nenv = { \(env) }"
        case .cursor, .other:
            let env = environment.map { "        \"\($0.0)\": \"\($0.1)\"" }.joined(separator: ",\n")
            return "{\n  \"mcpServers\": {\n    \"fliq\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"@fliq/mcp\"],\n      \"env\": {\n\(env)\n      }\n    }\n  }\n}"
        }
    }
}
