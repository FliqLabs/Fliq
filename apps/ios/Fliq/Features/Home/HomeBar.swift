import SwiftUI

enum RootTab: Hashable, CaseIterable {
    case home, activity, settings

    var symbol: String {
        switch self {
        case .home: "house.fill"
        case .activity: "clock.fill"
        case .settings: "gearshape.fill"
        }
    }

    var title: String {
        switch self {
        case .home: "Home"
        case .activity: "Activity"
        case .settings: "Settings"
        }
    }
}

/// What the + button fans out: each opens its own sheet.
enum MoneyAction: CaseIterable, Identifiable {
    case receive, send, request

    var id: Self { self }

    var title: String {
        switch self {
        case .receive: "Receive"
        case .send: "Send"
        case .request: "Request"
        }
    }

    var symbol: String {
        switch self {
        case .receive: "arrow.down"
        case .send: "paperplane.fill"
        case .request: "link"
        }
    }

    var tint: Color {
        switch self {
        case .receive: Color(hex: 0xF28A4B)
        case .send: Color(hex: 0x8B6CFF)
        case .request: Color(hex: 0x4C8DFF)
        }
    }
}

/// The tabs in a glass capsule on the left, and + on its own on the right, as one glass group.
struct HomeBar: View {
    @Binding var tab: RootTab
    @Binding var isMenuOpen: Bool
    @Namespace private var glass

    var body: some View {
        FliqGlassContainer(spacing: 20) {
            HStack(alignment: .bottom) {
                HStack(spacing: 4) {
                    ForEach(RootTab.allCases, id: \.self) { item in
                        Button {
                            tab = item
                        } label: {
                            Image(systemName: item.symbol)
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(item == tab ? Theme.textPrimary : Theme.textTertiary)
                                .frame(width: 58, height: 50)
                                .background(item == tab ? Color.white.opacity(0.1) : .clear, in: Capsule())
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.pressable)
                        .accessibilityLabel(item.title)
                        .accessibilityAddTraits(item == tab ? .isSelected : [])
                    }
                }
                .padding(6)
                .fliqGlass(Capsule(), interactive: true)
                .fliqGlassID("tabs", in: glass)
                .opacity(isMenuOpen ? 0 : 1)

                Spacer()

                Button {
                    withAnimation(.spring(response: 0.38, dampingFraction: 0.78)) { isMenuOpen.toggle() }
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .rotationEffect(.degrees(isMenuOpen ? 45 : 0))
                        .frame(width: 62, height: 62)
                        .contentShape(Circle())
                }
                .buttonStyle(.pressable)
                .fliqGlass(Circle(), interactive: true)
                .fliqGlassID("plus", in: glass)
                .accessibilityLabel(isMenuOpen ? "Close" : "Receive, send or request")
            }
        }
        .padding(.horizontal, 20)
        .sensoryFeedback(.impact(weight: .medium), trigger: isMenuOpen)
    }
}

/// The blurred cover with Receive, Send and Request stacked above +, labels on the left like a speed dial.
struct MoneyMenu: View {
    @Binding var isOpen: Bool
    let onPick: (MoneyAction) -> Void

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(Color.black.opacity(0.35))
                .ignoresSafeArea()
                .onTapGesture { close() }
                .accessibilityLabel("Close")
                .accessibilityAddTraits(.isButton)

            VStack(alignment: .trailing, spacing: 26) {
                ForEach(Array(MoneyAction.allCases.enumerated()), id: \.element) { index, action in
                    Button {
                        close()
                        onPick(action)
                    } label: {
                        HStack(spacing: 18) {
                            Text(action.title)
                                .font(.system(size: 19, weight: .medium))
                                .foregroundStyle(Theme.textPrimary)
                            Image(systemName: action.symbol)
                                .font(.system(size: 26, weight: .bold))
                                .foregroundStyle(action.tint)
                                .frame(width: 44, height: 44)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.pressable)
                    .transition(.move(edge: .bottom).combined(with: .opacity).animation(.spring(response: 0.4, dampingFraction: 0.8).delay(Double(MoneyAction.allCases.count - index) * 0.03)))
                }
            }
            .padding(.trailing, 29)
            .padding(.bottom, 96)
        }
    }

    private func close() {
        withAnimation(.spring(response: 0.34, dampingFraction: 0.85)) { isOpen = false }
    }
}
