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
    @State private var filter = RecentRecipients.Filter.all
    @State private var search = ""
    @State private var isSearching = false
    @State private var appeared = false
    @State private var choosingWhatToAdd = false
    @State private var draft: WalletDraft?
    @State private var renaming: SavedWallet?
    @State private var newLabel = ""
    @State private var deleting: SavedWallet?
    @State private var problem: String?

    static let gridCount = 6

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if recipients.isEmpty {
                empty
            } else {
                grid.padding(.top, 20)
                sheet.padding(.top, 24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.ground.ignoresSafeArea())
        // Swiping back has no button; VoiceOver's two-finger scrub does the same.
        .accessibilityAction(.escape) { onBack() }
        .task(id: isShown) {
            guard isShown || people.isEmpty else { return }
            if let loaded = try? await environment.api.recentPeople().items { people = loaded }
        }
        .confirmationDialog("Add", isPresented: $choosingWhatToAdd, titleVisibility: .hidden) {
            Button("Bank account") { onAdd() }
            Button("Stablecoin wallet") { draft = WalletDraft() }
        }
        .sheet(item: $draft) { draft in
            AddWalletView(draft: draft) { self.draft = nil }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(32)
                .presentationBackground(Color(hex: 0x161616))
        }
        .alert("Rename wallet", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newLabel)
            Button("Save") { rename() }
                .disabled(WalletAddress.labelProblem(newLabel) != nil)
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(
            "Delete \(deleting?.label ?? "this wallet")?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { delete() }
        } message: {
            Text("You can save it again any time.")
        }
        .alert("Something went wrong", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(problem ?? "")
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
        return RecentRecipients.merge(accounts: accounts, people: people, payments: payments, wallets: environment.wallets.saved)
    }

    private func rename() {
        guard let wallet = renaming, WalletAddress.labelProblem(newLabel) == nil else { return }
        let label = newLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do { try await environment.wallets.rename(wallet, to: label) } catch { problem = "Couldn't rename \(wallet.label). Check your connection and try again." }
        }
    }

    private func delete() {
        guard let wallet = deleting else { return }
        Task {
            do { try await environment.wallets.remove(wallet) } catch { problem = "Couldn't delete \(wallet.label). Check your connection and try again." }
        }
    }

    /// Long press on a saved wallet: rename it or delete it.
    @ViewBuilder
    private func manage(_ recipient: RecentRecipient) -> some View {
        if case .wallet(let wallet) = recipient.kind {
            Button {
                newLabel = wallet.label
                renaming = wallet
            } label: { Label("Rename", systemImage: "pencil") }
            Button(role: .destructive) { deleting = wallet } label: { Label("Delete", systemImage: "trash") }
        }
    }

    // MARK: Top

    private var header: some View {
        HStack(alignment: .center) {
            Text("Recipients")
                .font(.system(size: 34, weight: .bold))
                .tracking(-0.6)
                .foregroundStyle(Theme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Button { tap { choosingWhatToAdd = true } } label: {
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
        .padding(.leading, 20)
        .padding(.trailing, 16)
        .padding(.top, 12)
    }

    private var grid: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: 3)
        return LazyVGrid(columns: columns, spacing: 20) {
            ForEach(Array(recipients.prefix(Self.gridCount).enumerated()), id: \.element.id) { index, recipient in
                Button { tap { onPay(recipient) } } label: { tile(recipient) }
                    .buttonStyle(.pressable(scale: reduceMotion ? 1 : 0.92))
                    .contextMenu { manage(recipient) }
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
        case .wallet(let wallet):
            ChainBadge(chain: wallet.network, size: size)
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
                        Text(search.isEmpty ? emptyText : "No one matches \u{201C}\(search)\u{201D}")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.top, 32)
                    }
                    if filter != .banks, search.isEmpty, !environment.wallets.sentBefore.isEmpty { sentBefore }
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
        RecentRecipients.filter(recipients, by: filter, search: search)
    }

    private var emptyText: String {
        switch filter {
        case .all: "No one yet"
        case .banks: "No bank accounts yet"
        case .stablecoins: "No saved wallets yet"
        }
    }

    /// Wallets this iPhone sent to without naming them. A name makes them a saved wallet, on every device.
    private var sentBefore: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Sent before, not saved")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textTertiary)
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 4)
            ForEach(environment.wallets.sentBefore) { entry in
                HStack(spacing: 14) {
                    ChainBadge(chain: .near, size: 46)
                    Text(WalletAddress.short(entry.address, on: WalletChain.near.rawValue))
                        .font(.system(size: 15, design: .monospaced))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 8)
                    Button("Name it") { tap { draft = WalletDraft(chain: .near, address: entry.address) } }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .background(Theme.surfaceRaised, in: Capsule())
                        .buttonStyle(.pressable)
                        .accessibilityLabel("Name the wallet \(entry.address)")
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
            }
        }
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
        .contextMenu { manage(recipient) }
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
        case .wallet(let wallet):
            VStack(alignment: .trailing, spacing: 2) {
                Text(wallet.network?.name ?? wallet.chain)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                Text(wallet.shortAddress)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Theme.textTertiary)
            }
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

/// "All", "Banks" and "Stablecoins", in the same white-on-dark capsules as the Pay to chips.
private struct FilterControl: View {
    @Binding var selection: RecentRecipients.Filter

    var body: some View {
        HStack(spacing: 4) {
            ForEach(RecentRecipients.Filter.allCases, id: \.self) { segment($0.title, $0) }
        }
        .padding(4)
        .background(Theme.surfaceRaised, in: Capsule())
    }

    private func segment(_ title: String, _ value: RecentRecipients.Filter) -> some View {
        let selected = selection == value
        return Button {
            withAnimation(.snappy(duration: 0.2)) { selection = value }
        } label: {
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(selected ? .black : Theme.textSecondary)
                .padding(.horizontal, 14)
                .frame(height: 32)
                .background(selected ? Color.white : Color.clear, in: Capsule())
        }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
