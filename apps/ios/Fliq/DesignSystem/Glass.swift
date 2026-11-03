import SwiftUI

extension View {
    /// Liquid Glass on iOS 26 and later; the flat App v5 surface before that.
    /// `interactive` lets the glass react to touch (it swells and lights up under the finger).
    @ViewBuilder
    func fliqGlass<S: Shape>(_ shape: S, tint: Color? = nil, interactive: Bool = false) -> some View {
        if #available(iOS 26.0, *) {
            glassEffect(.regular.tint(tint).interactive(interactive), in: shape)
        } else {
            background(tint?.opacity(0.25) ?? Color.white.opacity(0.08), in: shape)
                .overlay(shape.stroke(Color.white.opacity(0.12)))
        }
    }

    /// Ties two glass shapes together so they blend and morph into each other as they move.
    @ViewBuilder
    func fliqGlassID<ID: Hashable & Sendable>(_ id: ID, in namespace: Namespace.ID) -> some View {
        if #available(iOS 26.0, *) {
            glassEffectID(id, in: namespace)
        } else {
            self
        }
    }
}

/// Groups glass shapes so nearby ones merge like drops of liquid. A plain stack before iOS 26.
struct FliqGlassContainer<Content: View>: View {
    var spacing: CGFloat = 12
    @ViewBuilder let content: Content

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
    }
}

/// A soft spring press with a light tap of haptics, for anything that should feel physical.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.94

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.6), value: configuration.isPressed)
            .sensoryFeedback(.selection, trigger: configuration.isPressed) { _, pressed in pressed }
    }
}

extension ButtonStyle where Self == PressableStyle {
    static var pressable: PressableStyle { PressableStyle() }
}
