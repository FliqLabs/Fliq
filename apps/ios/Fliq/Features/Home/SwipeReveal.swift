import SwiftUI

/// The decisions behind swiping from Home to Recipients: which way a drag is going, how far the page follows it,
/// and whether it settles open or closed when the finger lifts.
struct SwipeReveal: Equatable {
    enum Axis: Equatable {
        case horizontal, vertical
    }

    static let openFraction: CGFloat = 0.35
    /// Points per second. A flick this fast settles the way it was going, however short it was.
    static let flickSpeed: CGFloat = 500
    /// A drag counts as horizontal only when it moves at least this many times further across than down.
    static let horizontalBias: CGFloat = 1.5
    /// No bounce, so it reads the same with Reduce Motion on.
    static let settle = Animation.smooth(duration: 0.32)

    let axis: Axis
    let startedOpen: Bool
    /// 0 is Home, 1 is Recipients fully open.
    var progress: CGFloat

    /// Decided once, on the drag's first movement, and kept for the rest of it, so a scroll never turns into a swipe.
    static func axis(of translation: CGSize) -> Axis {
        abs(translation.width) > abs(translation.height) * horizontalBias ? .horizontal : .vertical
    }

    /// Follows a drag. `current` is nil on its first movement.
    static func track(_ current: SwipeReveal?, translation: CGSize, width: CGFloat, isOpen: Bool) -> SwipeReveal {
        let axis = current?.axis ?? axis(of: translation)
        let startedOpen = current?.startedOpen ?? isOpen
        guard axis == .horizontal, width > 0 else {
            return SwipeReveal(axis: axis, startedOpen: startedOpen, progress: startedOpen ? 1 : 0)
        }
        let start: CGFloat = startedOpen ? 1 : 0
        let progress = min(1, max(0, start + translation.width / width))
        return SwipeReveal(axis: axis, startedOpen: startedOpen, progress: progress)
    }

    /// Whether Recipients ends open. A vertical drag never changes anything.
    func settlesOpen(velocity: CGFloat) -> Bool {
        guard axis == .horizontal else { return startedOpen }
        if velocity >= Self.flickSpeed { return true }
        if velocity <= -Self.flickSpeed { return false }
        return startedOpen ? progress > 1 - Self.openFraction : progress >= Self.openFraction
    }
}

/// Home with Recipients waiting off its left edge. Dragging toward the right edge pulls Recipients in under the finger;
/// dragging back, or its back button, returns to Home.
struct SwipeToRecipients<Home: View, Recipients: View>: View {
    @Binding var isOpen: Bool
    @ViewBuilder let home: () -> Home
    /// Told whether any of Recipients is on screen, so it can play its entrance as soon as it starts to show.
    @ViewBuilder let recipients: (_ isShown: Bool) -> Recipients

    @State private var drag: SwipeReveal?
    @State private var tapGuard = SwipeTapGuard()
    /// Keeps Home's own buttons from firing on the touch-up that ends a swipe.
    @State private var isQuiet = false
    /// True only while a finger is down. A drag the system cancels never reaches `onEnded`, so this settles it instead.
    @GestureState private var isTouching = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let progress = drag?.axis == .horizontal ? drag?.progress ?? 0 : (isOpen ? 1 : 0)
            ZStack {
                home()
                    .disabled(drag?.axis == .horizontal || isQuiet)
                    .offset(x: reduceMotion ? 0 : progress * width * 0.25)
                    .opacity(reduceMotion ? 1 - progress : 1)
                    .accessibilityHidden(isOpen)
                recipients(progress > 0 || isOpen)
                    .offset(x: -(1 - progress) * width)
                    .accessibilityHidden(!isOpen)
            }
            .environment(\.swipeTapGuard, tapGuard)
            .simultaneousGesture(swipe(width: width))
        }
        .onChange(of: isTouching) { _, touching in
            if !touching, let drag { settle(open: drag.settlesOpen(velocity: 0)) }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: isOpen) { _, open in open }
    }

    /// Runs beside the scroll views inside, never in front of them: a vertical drag still scrolls and refreshes.
    private func swipe(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 14)
            .updating($isTouching) { _, touching, _ in touching = true }
            .onChanged { value in
                drag = SwipeReveal.track(drag, translation: value.translation, width: width, isOpen: isOpen)
                if drag?.axis == .horizontal { tapGuard.swiped() }
            }
            .onEnded { value in
                guard let drag else { return }
                settle(open: drag.settlesOpen(velocity: value.velocity.width))
            }
    }

    private func settle(open: Bool) {
        if drag?.axis == .horizontal { quiet() }
        withAnimation(SwipeReveal.settle) {
            drag = nil
            isOpen = open
        }
    }

    private func quiet() {
        tapGuard.swiped()
        isQuiet = true
        Task {
            try? await Task.sleep(for: .seconds(SwipeTapGuard.quiet))
            isQuiet = false
        }
    }
}

/// A finger that swipes between Home and Recipients is not a tap. Buttons under it check this before acting, because
/// a sideways drag inside a scroll view does not cancel the button it started on.
@MainActor
final class SwipeTapGuard {
    /// Long enough to cover the button's touch-up arriving after the drag has ended.
    static let quiet: TimeInterval = 0.35
    private(set) var quietUntil = Date.distantPast

    func swiped(at now: Date = .now) { quietUntil = now.addingTimeInterval(Self.quiet) }
    func allowsTap(at now: Date = .now) -> Bool { now >= quietUntil }
}

extension EnvironmentValues {
    @Entry var swipeTapGuard: SwipeTapGuard?
}
