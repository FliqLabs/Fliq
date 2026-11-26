import SwiftUI

/// Swiped in from Home: everyone you pay, most recent first. The grid holds the newest few, the sheet below holds all.
struct RecipientsView: View {
    let isShown: Bool
    let onBack: () -> Void
    let onAdd: () -> Void
    let onSend: () -> Void
    let onPay: (RecentRecipient) -> Void
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.swipeTapGuard) private var tapGuard
    @State private var people: [RecentPerson] = []
    @State private var filter = Filter.all
    @State private var search = ""
    @State private var isSearching = false
    @State private var appeared = false

    enum Filter: Hashable {
        case all, banks
    }

    static let gridCount = 6

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Text("Recipients")
                .font(.system(size: 34, weight: .bold))
                .tracking(-0.6)
                .foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .accessibilityAddTraits(.isHeader)
            if recipients.isEmpty {
                empty
            } else {
                grid.padding(.top, 20)
                sheet.padding(.top, 24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.ground.ignoresSafeArea())
        .task(id: isShown) {
            guard isShown || people.isEmpty else { return }
            if let loaded = try? await environment.api.recentPeople().items { people = loaded }
        }
        .onChange(of: isShown, initial: true) { _, shown in
            if reduceMotion || !shown {
                appeared = shown
            } else {
                withAnimation(.easeOut(duration: 0.3)) { appeared = true }
            }
        }
    }

    /// Ignores the touch-up of a finger that was swiping between Home and Recipients.
    private func tap(_ action: () -> Void) {
        guard tapGuard?.allowsTap() ?? true else { return }
        action()
    }

    private var recipients: [RecentRecipient] {
        let accounts = [environment.accounts.own].compactMap { $0 } + environment.accounts.saved
        let payments = RecentRecipients.payments(entries: environment.activity.entries, history: environment.activity.history)
        return RecentRecipients.merge(accounts: accounts, people: people, payments: payments)
    }

    // MARK: Top

    private var header: some View {
        HStack {
            Button { tap(onBack) } label: {
                Icon("chevron.left", size: 20)
                    .foregroundStyle(Theme.textPrimary)
                    .frame(width: 40, height: 40)
                    .fliqGlass(Circle())
            }
            .buttonStyle(.pressable)
            .accessibilityLabel("Back to Home")
            Spacer()
            Button { tap(onAdd) } label: {
                IconLabel("Add", icon: "plus", size: 16)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 16)
                    .frame(height: 36)
                    .background(.white, in: Capsule())
            }
            .buttonStyle(.pressable)
            .accessibilityLabel("Add a recipient")
            .accessibilityIdentifier("recipients.add")
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var grid: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: 3)
        return LazyVGrid(columns: columns, spacing: 20) {
            ForEach(Array(recipients.prefix(Self.gridCount).enumerated()), id: \.element.id) { index, recipient in
                Button { tap { onPay(recipient) } } label: { tile(recipient) }
                    .buttonStyle(.pressable(scale: reduceMotion ? 1 : 0.92))
                    .accessibilityLabel(recipient.accessibilityLabel)
                    .opacity(appeared ? 1 : 0)
                    .offset(y: appeared || reduceMotion ? 0 : 10)
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.3).delay(Double(index) * 0.04), value: appeared)
            }
        }
        .padding(.horizontal, 16)
    }

    private func tile(_ recipient: RecentRecipient) -> some View {
        VStack(spacing: 8) {
            avatar(recipient, size: 68)
            VStack(spacing: 2) {
                Text(recipient.firstName)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text(recipient.detail)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
            .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
    }

    private func avatar(_ recipient: RecentRecipient, size: CGFloat) -> some View {
        PersonAvatar(name: recipient.name, photoURL: recipient.photoURL, size: size)
            .overlay(alignment: .bottomTrailing) { badge(recipient, size: size * 0.32).offset(x: 2, y: 2) }
    }

    @ViewBuilder
    private func badge(_ recipient: RecentRecipient, size: CGFloat) -> some View {
        switch recipient.kind {
        case .bank(let account):
            InstitutionLogo(logoKey: account.logoKey, name: account.institution, size: size)
                .overlay(Circle().strokeBorder(Color(hex: 0x141414), lineWidth: 2))
        case .person:
            NEARMark(size: size * 0.55)
                .frame(width: size, height: size)
                .background(Color.black, in: Circle())
                .overlay(Circle().strokeBorder(Color(hex: 0x141414), lineWidth: 2))
        }
    }

    // MARK: Sheet

    private var sheet: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Color.white.opacity(0.2))
                .frame(width: 36, height: 5)
                .padding(.top, 8)
            HStack(spacing: 10) {
                FilterControl(selection: $filter)
                Spacer()
                Button {
                    withAnimation(.snappy(duration: 0.2)) {
                        isSearching.toggle()
                        if !isSearching { search = "" }
                    }
                } label: {
                    Icon(isSearching ? "xmark" : "magnifyingglass", size: 18)
                        .foregroundStyle(Theme.textPrimary)
                        .frame(width: 40, height: 40)
                        .background(Theme.surfaceRaised, in: Circle())
                }
                .buttonStyle(.pressable)
                .accessibilityLabel(isSearching ? "Close search" : "Search recipients")
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            if isSearching {
                SearchField(text: $search, prompt: "Name, bank or fliq name")
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
            ScrollView {
                LazyVStack(spacing: 0) {
                    let listed = filtered
                    ForEach(Array(listed.enumerated()), id: \.element.id) { index, recipient in
                        row(recipient, isLast: index == listed.count - 1)
                    }
                    if listed.isEmpty {
                        Text(search.isEmpty ? "No bank accounts yet" : "No one matches \u{201C}\(search)\u{201D}")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.top, 32)
                    }
                }
                .padding(.top, 8)
                .padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.immediately)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color(hex: 0x161616), in: UnevenRoundedRectangle(topLeadingRadius: 32, topTrailingRadius: 32, style: .continuous))
        .ignoresSafeArea(edges: .bottom)
    }

    private var filtered: [RecentRecipient] {
        recipients.filter { (filter == .all || $0.isBank) && $0.matches(search) }
    }

    private func row(_ recipient: RecentRecipient, isLast: Bool) -> some View {
        Button { tap { onPay(recipient) } } label: {
            HStack(spacing: 14) {
                avatar(recipient, size: 46)
                Text(recipient.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                trailing(recipient)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
            .overlay(alignment: .bottom) {
                if !isLast { Rectangle().fill(Color.white.opacity(0.06)).frame(height: 1).padding(.leading, 80) }
            }
        }
        .buttonStyle(.pressable(scale: reduceMotion ? 1 : 0.98))
        .accessibilityLabel(recipient.accessibilityLabel)
    }

    @ViewBuilder
    private func trailing(_ recipient: RecentRecipient) -> some View {
        switch recipient.kind {
        case .bank(let account):
            VStack(alignment: .trailing, spacing: 2) {
                Text(account.institution)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                Text(String(account.number.suffix(4)))
                    .font(.system(size: 13).monospacedDigit())
                    .foregroundStyle(Theme.textTertiary)
            }
            .lineLimit(1)
        case .person(let person):
            Text(FliqName.display(person.nearAccount))
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
        }
    }

    // MARK: Empty

    private var empty: some View {
        VStack(spacing: 14) {
            Icon("person.2", size: 28)
                .foregroundStyle(Theme.textTertiary)
                .frame(width: 64, height: 64)
                .background(Theme.surfaceRaised, in: Circle())
            Text("People you pay show up here")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
            Button("Send") { tap(onSend) }
                .buttonStyle(PrimaryButtonStyle(filled: true))
                .frame(width: 180)
                .padding(.top, 6)
                .accessibilityIdentifier("recipients.send")
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 96)
    }
}

/// "All" and "Banks", in the same white-on-dark capsules as the Pay to chips.
private struct FilterControl: View {
    @Binding var selection: RecipientsView.Filter

    var body: some View {
        HStack(spacing: 4) {
            segment("All", .all)
            segment("Banks", .banks)
        }
        .padding(4)
        .background(Theme.surfaceRaised, in: Capsule())
    }

    private func segment(_ title: String, _ value: RecipientsView.Filter) -> some View {
        let selected = selection == value
        return Button {
            withAnimation(.snappy(duration: 0.2)) { selection = value }
        } label: {
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(selected ? .black : Theme.textSecondary)
                .padding(.horizontal, 18)
                .frame(height: 32)
                .background(selected ? Color.white : Color.clear, in: Capsule())
        }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
