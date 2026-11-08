import SwiftUI

/// The sheet Send opens: your own account, saved accounts and fliq users you paid, with search.
struct PayToView: View {
    let onAccount: (VerifiedAccount) -> Void
    /// Nil opens Pay a fliq user with an empty name.
    let onPerson: (String?) -> Void
    let onNew: () -> Void
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var filter = Filter.all
    @State private var people: [RecentPerson] = []

    enum Filter: Hashable {
        case all, country(Country), fliqUsers
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            searchField.padding(.top, 20)
            chips.padding(.top, 14)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let own = shownOwn {
                        section("Yours")
                        accountRow(own)
                    }
                    if !shownSaved.isEmpty || !shownPeople.isEmpty {
                        section("Saved")
                        VStack(spacing: 10) {
                            ForEach(shownSaved, id: \.number) { accountRow($0) }
                            ForEach(shownPeople) { personRow($0) }
                        }
                    }
                    if let typed = typedName {
                        section("On fliq")
                        Button { onPerson(typed.account) } label: {
                            row(title: "Pay \(typed.value)", detail: "\(typed.account) · instant, no fee") {
                                Image("NearLogo").resizable().renderingMode(.template).scaledToFit().padding(11)
                                    .foregroundStyle(Color(hex: 0x00EC97))
                                    .frame(width: 44, height: 44)
                                    .background(Color.black, in: Circle())
                            }
                        }
                    } else if isEmpty {
                        emptyState
                    }
                }
                .padding(.bottom, 96)
            }
            .scrollIndicators(.hidden)
        }
        .padding(.horizontal, 16)
        .overlay(alignment: .bottomTrailing) { newRecipient }
        .task { people = (try? await environment.api.recentPeople().items) ?? [] }
    }

    private var header: some View {
        ZStack {
            Text("Pay to").font(.system(size: 17, weight: .semibold))
            HStack {
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 17, weight: .medium))
                }
                .accessibilityLabel("Close")
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .padding(.top, 22)
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.textSecondary)
            TextField("Search", text: $search)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
        .font(.system(size: 17))
        .padding(.horizontal, 16)
        .frame(height: 48)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14))
    }

    private var chips: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                chip(.all) { Text("All") }
                ForEach(Country.allCases, id: \.self) { country in
                    chip(.country(country)) {
                        CountryFlag(country: country, size: 20)
                        Text(country.currency.rawValue.uppercased())
                    }
                }
                chip(.fliqUsers) {
                    Image("NearLogo").resizable().renderingMode(.template).scaledToFit().frame(width: 15, height: 15)
                        .foregroundStyle(Color(hex: 0x00EC97))
                    Text("fliq users")
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    private func chip<Label: View>(_ value: Filter, @ViewBuilder label: () -> Label) -> some View {
        Button { filter = value } label: {
            HStack(spacing: 7) { label() }
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(filter == value ? .black : Theme.textPrimary)
                .padding(.horizontal, 14)
                .frame(height: 38)
                .background(filter == value ? Color.white : Theme.surfaceRaised, in: Capsule())
        }
    }

    private func section(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 15))
            .foregroundStyle(Theme.textSecondary)
            .padding(.top, 22)
            .padding(.bottom, 10)
            .padding(.horizontal, 2)
    }

    private func accountRow(_ account: VerifiedAccount) -> some View {
        Button { onAccount(account) } label: {
            row(title: account.accountName, detail: "\(account.institution) ···\(account.number.suffix(account.country == .ke ? 3 : 4))") {
                BadgedAvatar(avatar: PersonAvatar(name: account.accountName)) {
                    InstitutionLogo(logoKey: account.logoKey ?? Institution.supported.first { $0.code == account.bank }?.logoKey, name: account.institution, size: 20)
                }
            }
        }
    }

    private func personRow(_ person: RecentPerson) -> some View {
        Button { onPerson(person.nearAccount) } label: {
            row(title: person.displayName ?? person.nearAccount, detail: "\(person.nearAccount) · instant, no fee") {
                BadgedAvatar(avatar: PersonAvatar(name: person.displayName ?? person.nearAccount, photoURL: person.photoUrl.flatMap(URL.init(string:)))) {
                    Image("NearLogo").resizable().renderingMode(.template).scaledToFit().padding(4)
                        .foregroundStyle(Color(hex: 0x00EC97))
                        .background(Color.black, in: Circle())
                }
            }
        }
    }

    private func row<Mark: View>(title: String, detail: String, @ViewBuilder mark: () -> Mark) -> some View {
        HStack(spacing: 14) {
            mark()
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 17, weight: .semibold)).lineLimit(1)
                Text(detail).font(.system(size: 14)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.textTertiary)
        }
        .foregroundStyle(Theme.textPrimary)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 18))
        .contentShape(Rectangle())
    }

    private var newRecipient: some View {
        Button { filter == .fliqUsers ? onPerson(nil) : onNew() } label: {
            Label("New recipient", systemImage: "plus")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.black)
                .padding(.horizontal, 22)
                .frame(height: 52)
                .background(.white, in: Capsule())
        }
        .padding(.trailing, 16)
        .padding(.bottom, 12)
    }

    private var emptyState: some View {
        Text(search.isEmpty ? "No one saved yet. Add a new recipient." : "No one matches \u{201C}\(search)\u{201D}.")
            .font(.system(size: 15))
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.top, 40)
    }

    /// What's typed in search, read as a fliq name, when it isn't someone already listed.
    private var typedName: FliqName? {
        guard filter == .all || filter == .fliqUsers, let name = FliqName(search.trimmingCharacters(in: .whitespaces).lowercased()) else { return nil }
        return people.contains { $0.nearAccount == name.account } ? nil : name
    }

    private var isEmpty: Bool { shownOwn == nil && shownSaved.isEmpty && shownPeople.isEmpty }

    private var shownOwn: VerifiedAccount? {
        environment.accounts.own.flatMap { matches($0) ? $0 : nil }
    }

    private var shownSaved: [VerifiedAccount] {
        environment.accounts.saved.filter(matches)
    }

    private var shownPeople: [RecentPerson] {
        guard filter == .all || filter == .fliqUsers else { return [] }
        return people.filter { matches(search: [$0.displayName ?? "", $0.nearAccount]) }
    }

    private func matches(_ account: VerifiedAccount) -> Bool {
        switch filter {
        case .fliqUsers: return false
        case .country(let country) where (account.country ?? .ng) != country: return false
        default: return matches(search: [account.accountName, account.institution, account.number])
        }
    }

    private func matches(search fields: [String]) -> Bool {
        let query = search.trimmingCharacters(in: .whitespaces)
        return query.isEmpty || fields.contains { $0.localizedCaseInsensitiveContains(query) }
    }
}
