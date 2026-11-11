import SwiftUI
import UIKit

/// The sheet Send opens: who you paid lately, your own account, everyone you saved, and search across all of it.
struct PayToView: View {
    let onAccount: (VerifiedAccount) -> Void
    /// Nil opens Pay a fliq user with an empty name.
    let onPerson: (String?) -> Void
    let onNew: () -> Void
    var onScan: (() -> Void)?
    var onWallet: (() -> Void)?
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var filter = Filter.all
    @State private var people: [RecentPerson] = []
    @State private var removing: VerifiedAccount?
    @FocusState private var searching: Bool

    enum Filter: Hashable {
        case all, country(Country), fliqUsers
    }

    /// One person or account the sheet can pay.
    private enum Payee: Identifiable, Hashable {
        case account(VerifiedAccount)
        case person(RecentPerson)

        var id: String {
            switch self {
            case .account(let account): "\(account.bank)-\(account.number)"
            case .person(let person): person.nearAccount
            }
        }

        var name: String {
            switch self {
            case .account(let account): account.accountName.localizedCapitalized
            case .person(let person): person.displayName ?? FliqName.display(person.nearAccount)
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            searchField.padding(.top, 8)
            chips.padding(.top, 12)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if isSearching {
                        results
                    } else {
                        browsing
                    }
                }
                .padding(.bottom, 110)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.immediately)
        }
        .padding(.horizontal, 16)
        .overlay(alignment: .bottomTrailing) { newRecipient }
        .navigationTitle("Pay to")
        .navigationBarTitleDisplayMode(.inline)
        .sheetToolbar { dismiss() }
        .task { people = (try? await environment.api.recentPeople().items) ?? [] }
        .confirmationDialog(
            "Remove \(removing?.accountName.localizedCapitalized ?? "this account")?",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                if let removing { environment.accounts.remove(removing) }
            }
        } message: {
            Text("It leaves your saved list on this iPhone. Payments you made stay in Activity.")
        }
    }

    // MARK: Top

    private var searchField: some View {
        HStack(spacing: 10) {
            Icon("magnifyingglass", size: 19)
                .foregroundStyle(searching ? Theme.textPrimary : Theme.textTertiary)
            TextField("", text: $search, prompt: Text("Name, bank, account number or fliq name").foregroundStyle(Theme.textTertiary))
                .focused($searching)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .accessibilityLabel("Search")
            if !search.isEmpty {
                Button { search = "" } label: {
                    Icon("xmark.circle.fill", size: 18).foregroundStyle(Theme.textTertiary)
                }
                .accessibilityLabel("Clear search")
            }
        }
        .font(.system(size: 16))
        .padding(.horizontal, 14)
        .frame(height: 50)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14))
        .overlay {
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(searching ? Color.white.opacity(0.35) : Color.white.opacity(0.06))
        }
        .animation(.easeOut(duration: 0.15), value: searching)
    }

    private var chips: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                chip(.all, count: nil) {
                    Icon("globe", size: 17)
                    Text("All")
                }
                ForEach(Country.allCases, id: \.self) { country in
                    chip(.country(country), count: accounts(in: country).count) {
                        CountryFlag(country: country, size: 18)
                        Text(country.currency.rawValue.uppercased())
                    }
                }
                chip(.fliqUsers, count: people.count) {
                    NEARMark(size: 14)
                    Text("fliq users")
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    private func chip<Label: View>(_ value: Filter, count: Int?, @ViewBuilder label: () -> Label) -> some View {
        let selected = filter == value
        return Button {
            withAnimation(.snappy(duration: 0.2)) { filter = value }
        } label: {
            HStack(spacing: 7) {
                label()
                if let count, count > 0 {
                    Text("\(count)")
                        .font(.system(size: 12, weight: .semibold).monospacedDigit())
                        .foregroundStyle(selected ? Color.black.opacity(0.55) : Theme.textTertiary)
                }
            }
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(selected ? .black : Theme.textPrimary)
            .padding(.horizontal, 14)
            .frame(height: 38)
            .background(selected ? Color.white : Theme.surfaceRaised, in: Capsule())
        }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: Browsing

    @ViewBuilder
    private var browsing: some View {
        if let onScan, filter != .fliqUsers {
            actionRow("Scan to pay", detail: "A bank QR code or an account number", icon: "qrcode.viewfinder", action: onScan)
                .padding(.top, 16)
        }
        if let onWallet, filter == .all {
            actionRow("Send to a wallet", detail: "USDC to any NEAR address", icon: "arrow.up.right", action: onWallet)
                .padding(.top, 10)
        }

        if filter == .all, !recent.isEmpty {
            sectionTitle("Recent")
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(recent) { payee in
                        Button { pay(payee) } label: { RecentBubble(name: payee.name) { badge(for: payee) } }
                    }
                }
                .padding(.horizontal, 2)
            }
            .scrollIndicators(.hidden)
        }

        if let own = environment.accounts.own, shows(own) {
            sectionTitle("Yours")
            card { row(.account(own), isOwn: true, isLast: true) }
        }

        let everyone = listed
        if !everyone.isEmpty {
            sectionTitle(filter == .fliqUsers ? "fliq users" : "All recipients", count: everyone.count)
            card {
                ForEach(Array(everyone.enumerated()), id: \.element.id) { index, payee in
                    row(payee, isLast: index == everyone.count - 1)
                }
            }
        } else if environment.accounts.own == nil || filter != .all {
            emptyList
        }
    }

    // MARK: Searching

    @ViewBuilder
    private var results: some View {
        let found = matches
        if !found.isEmpty {
            sectionTitle("\(found.count) \(found.count == 1 ? "match" : "matches")")
            card {
                ForEach(Array(found.enumerated()), id: \.element.id) { index, payee in
                    row(payee, isOwn: isOwn(payee), isLast: index == found.count - 1)
                }
            }
        }
        if let typed = typedName {
            sectionTitle("On fliq")
            card {
                Button { onPerson(typed.account) } label: {
                    RowLayout(title: Text("Pay @\(typed.value)"), detail: Text("fliq user · instant, no fee").foregroundStyle(Theme.textSecondary)) {
                        NEARMark(size: 22)
                            .frame(width: 46, height: 46)
                            .background(Color.black, in: Circle())
                            .overlay(Circle().strokeBorder(Color.white.opacity(0.08)))
                    } trailing: {
                        chevron
                    }
                }
            }
        }
        if found.isEmpty, typedName == nil {
            noMatch
        }
    }

    // MARK: Rows

    private func row(_ payee: Payee, isOwn: Bool = false, isLast: Bool) -> some View {
        Button { pay(payee) } label: {
            RowLayout(title: highlighted(payee.name), detail: detail(for: payee), tag: isOwn ? "You" : nil, isLast: isLast) {
                PersonAvatar(name: payee.name, photoURL: photo(of: payee), size: 46)
                    .overlay(alignment: .bottomTrailing) { badge(for: payee).offset(x: 3, y: 3) }
            } trailing: {
                if case .account(let account) = payee, !isOwn {
                    menu(for: account)
                } else {
                    chevron
                }
            }
        }
        .contextMenu { contextActions(for: payee, isOwn: isOwn) }
    }

    private func detail(for payee: Payee) -> Text {
        switch payee {
        case .account(let account):
            let digits = account.country == .ke ? 3 : 4
            let number = isSearching && query.allSatisfy(\.isNumber) ? account.number : "···\(account.number.suffix(digits))"
            return highlighted(account.institution, base: Theme.textSecondary) + Text("  ·  ").foregroundStyle(Theme.textTertiary)
                + highlighted(number, base: Theme.textSecondary)
        case .person(let person):
            return highlighted(FliqName.display(person.nearAccount), base: Theme.textSecondary)
                + Text("  ·  instant, no fee").foregroundStyle(Theme.confirmed.opacity(0.85))
        }
    }

    @ViewBuilder
    private func badge(for payee: Payee) -> some View {
        switch payee {
        case .account(let account):
            CountryFlag(country: account.country ?? .ng, size: 18)
                .overlay(Circle().strokeBorder(Color(hex: 0x141414), lineWidth: 2))
        case .person:
            NEARMark(size: 10)
                .frame(width: 18, height: 18)
                .background(Color.black, in: Circle())
                .overlay(Circle().strokeBorder(Color(hex: 0x141414), lineWidth: 2))
        }
    }

    private func menu(for account: VerifiedAccount) -> some View {
        Menu {
            Button { onAccount(account) } label: { IconLabel("Pay", icon: "paperplane") }
            Button { UIPasteboard.general.string = account.number } label: { IconLabel("Copy account number", icon: "doc.on.doc") }
            Button(role: .destructive) { removing = account } label: { IconLabel("Remove", icon: "trash") }
        } label: {
            Icon("ellipsis", size: 19)
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("More for \(account.accountName.localizedCapitalized)")
    }

    @ViewBuilder
    private func contextActions(for payee: Payee, isOwn: Bool) -> some View {
        switch payee {
        case .account(let account):
            Button { onAccount(account) } label: { IconLabel("Pay", icon: "paperplane") }
            Button { UIPasteboard.general.string = account.number } label: { IconLabel("Copy account number", icon: "doc.on.doc") }
            if !isOwn {
                Button(role: .destructive) { removing = account } label: { IconLabel("Remove", icon: "trash") }
            }
        case .person(let person):
            Button { onPerson(person.nearAccount) } label: { IconLabel("Pay", icon: "paperplane") }
            Button { UIPasteboard.general.string = FliqName.display(person.nearAccount) } label: { IconLabel("Copy fliq name", icon: "doc.on.doc") }
        }
    }

    private var chevron: some View {
        Icon("chevron.right", size: 16)
            .foregroundStyle(Theme.textTertiary)
            .frame(width: 36, height: 36)
    }

    private func actionRow(_ title: String, detail: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Icon(icon, size: 24)
                    .frame(width: 44, height: 44)
                    .background(Theme.surfaceRaised, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 17, weight: .semibold))
                    Text(detail)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                Icon("chevron.right", size: 17)
                    .foregroundStyle(Theme.textTertiary)
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Theme.surfaceRaised.opacity(0.7), in: RoundedRectangle(cornerRadius: 20))
        }
        .buttonStyle(.pressable(scale: 0.98))
        .accessibilityIdentifier(title)
    }

    private func sectionTitle(_ title: String, count: Int? = nil) -> some View {
        HStack(spacing: 6) {
            Text(title)
            if let count { Text("\(count)").foregroundStyle(Theme.textTertiary) }
        }
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(Theme.textSecondary)
        .padding(.top, 24)
        .padding(.bottom, 10)
        .padding(.horizontal, 2)
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(Theme.surfaceRaised.opacity(0.7), in: RoundedRectangle(cornerRadius: 20))
    }

    // MARK: Empty states

    private var emptyList: some View {
        VStack(spacing: 10) {
            Icon(filter == .fliqUsers ? "person.2" : "building.columns", size: 26)
                .foregroundStyle(Theme.textTertiary)
                .frame(width: 60, height: 60)
                .background(Theme.surfaceRaised, in: Circle())
            Text(filter == .fliqUsers ? "No fliq users yet" : "No one saved here yet")
                .font(.system(size: 17, weight: .semibold))
            Text(filter == .fliqUsers ? "Search a fliq name to pay someone instantly, with no fee." : "Accounts you pay and save show up here.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 48)
    }

    private var noMatch: some View {
        VStack(spacing: 10) {
            Text("No one matches \u{201C}\(query)\u{201D}")
                .font(.system(size: 16, weight: .semibold))
            Text("Check the spelling, or add them as a new recipient.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    private var newRecipient: some View {
        Button { filter == .fliqUsers ? onPerson(nil) : onNew() } label: {
            IconLabel("New recipient", icon: "plus")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.black)
                .padding(.horizontal, 22)
                .frame(height: 52)
                .background(.white, in: Capsule())
                .shadow(color: .black.opacity(0.5), radius: 16, y: 6)
        }
        .padding(.trailing, 16)
        .padding(.bottom, 12)
    }

    // MARK: Data

    private var isSearching: Bool { !query.isEmpty }
    private var query: String { search.trimmingCharacters(in: .whitespaces) }

    private func pay(_ payee: Payee) {
        switch payee {
        case .account(let account): onAccount(account)
        case .person(let person): onPerson(person.nearAccount)
        }
    }

    private func isOwn(_ payee: Payee) -> Bool {
        if case .account(let account) = payee { return account == environment.accounts.own }
        return false
    }

    private func photo(of payee: Payee) -> URL? {
        if case .person(let person) = payee { return person.photoUrl.flatMap(URL.init(string:)) }
        return nil
    }

    private func shows(_ account: VerifiedAccount) -> Bool {
        switch filter {
        case .all: true
        case .country(let country): (account.country ?? .ng) == country
        case .fliqUsers: false
        }
    }

    private func accounts(in country: Country) -> [VerifiedAccount] {
        environment.accounts.saved.filter { ($0.country ?? .ng) == country }
    }

    /// Everyone you saved, by name, under the filter.
    private var listed: [Payee] {
        let accounts = environment.accounts.saved.filter(shows).map(Payee.account)
        let users = (filter == .all || filter == .fliqUsers) ? people.map(Payee.person) : []
        return (accounts + users).sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// The last people and accounts paid, newest first: payouts on this iPhone and fliq users the API says you paid.
    private var recent: [Payee] {
        var dated: [(Date, Payee)] = people.compactMap { person in person.lastPaidAt.map { ($0, .person(person)) } }
        var seen = Set<String>()
        for entry in environment.activity.entries {
            let account = entry.payout.account
            let key = "\(account.bank)-\(account.number)"
            guard !seen.contains(key), let saved = environment.accounts.saved.first(where: { $0.bank == account.bank && $0.number == account.number }) else { continue }
            seen.insert(key)
            dated.append((entry.startedAt, .account(saved)))
        }
        let paid = dated.sorted { $0.0 > $1.0 }.map(\.1)
        let saved = environment.accounts.saved.map(Payee.account).filter { !paid.contains($0) }
        return Array((paid + saved).prefix(8))
    }

    private var matches: [Payee] {
        let own = environment.accounts.own.map { [Payee.account($0)] } ?? []
        return (own + listed).filter { payee in
            switch payee {
            case .account(let account): [account.accountName, account.institution, account.number].contains(where: contains)
            case .person(let person): [person.displayName ?? "", FliqName.display(person.nearAccount)].contains(where: contains)
            }
        }
    }

    private func contains(_ field: String) -> Bool {
        field.localizedCaseInsensitiveContains(query)
    }

    /// What's typed, read as a fliq name, when it isn't someone already listed.
    private var typedName: FliqName? {
        guard filter == .all || filter == .fliqUsers, !query.allSatisfy(\.isNumber), let account = FliqName.account(typed: query),
              let name = FliqName(String(account.dropLast(FliqName.suffix.count))) else { return nil }
        return people.contains { $0.nearAccount == name.account } ? nil : name
    }

    /// The matched part of a field in white, the rest in the row's own colour.
    private func highlighted(_ text: String, base: Color = Theme.textPrimary) -> Text {
        guard isSearching, let range = text.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) else {
            return Text(text).foregroundStyle(base)
        }
        return Text(text[..<range.lowerBound]).foregroundStyle(base)
            + Text(text[range]).foregroundStyle(Theme.textPrimary).fontWeight(.bold)
            + Text(text[range.upperBound...]).foregroundStyle(base)
    }
}

/// Avatar, two lines and a trailing control, with a hairline under all but the last row.
private struct RowLayout<Leading: View, Trailing: View>: View {
    let title: Text
    let detail: Text
    var tag: String?
    var isLast = true
    @ViewBuilder let leading: () -> Leading
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 14) {
            leading()
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    title.font(.system(size: 16, weight: .semibold)).lineLimit(1)
                    if let tag {
                        Text(tag)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.horizontal, 7)
                            .frame(height: 20)
                            .background(Color.white.opacity(0.08), in: Capsule())
                    }
                }
                detail.font(.system(size: 13)).lineLimit(1)
            }
            Spacer(minLength: 8)
            trailing()
        }
        .foregroundStyle(Theme.textPrimary)
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            if !isLast { Rectangle().fill(Color.white.opacity(0.06)).frame(height: 1).padding(.leading, 74) }
        }
    }
}

/// A recent payee as a round avatar with their first name under it.
private struct RecentBubble<Badge: View>: View {
    let name: String
    @ViewBuilder let badge: () -> Badge

    var body: some View {
        VStack(spacing: 8) {
            PersonAvatar(name: name, size: 56)
                .overlay(alignment: .bottomTrailing) { badge().offset(x: 2, y: 2) }
            Text(name.split(separator: " ").first.map(String.init) ?? name)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
                .frame(width: 64)
        }
    }
}
