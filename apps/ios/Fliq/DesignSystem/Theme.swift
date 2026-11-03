import SwiftUI

enum Theme {
    static let surface = Color(hex: 0x1A1A1A)
    static let surfaceRaised = Color(hex: 0x242424)
    static let actionBar = Color(hex: 0x1C1C1C)
    static let field = Color(hex: 0x1C1C1C)
    static let hairline = Color(hex: 0x2C2C2C)

    static let textPrimary = Color.white
    static let textSecondary = Color(hex: 0xA3A3A3)
    static let textTertiary = Color(hex: 0x6E6E6E)
    static let textDisabled = Color(hex: 0x5A5A5A)

    static let confirmed = Color(hex: 0x32B35A)
    static let warning = Color(hex: 0xE8A317)
    static let danger = Color(hex: 0xE5484D)

    static let ground = LinearGradient(
        colors: [Color(hex: 0x171717), Color(hex: 0x0B0B0B), .black],
        startPoint: .top,
        endPoint: .bottom
    )

    static let brand = RadialGradient(
        colors: [Color(hex: 0xD2C4FF), Color(hex: 0x7158FF), Color(hex: 0x1E2CFF)],
        center: UnitPoint(x: 0.35, y: 0.3),
        startRadius: 0,
        endRadius: 4
    )

    static func hero(_ size: CGFloat = 64) -> Font {
        .system(size: size, weight: .light).monospacedDigit()
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
