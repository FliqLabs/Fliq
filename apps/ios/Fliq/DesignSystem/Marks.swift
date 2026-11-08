import SwiftUI
import UIKit

/// A bank or mobile money logo from `logo_key`, or its initials when the app ships no logo for it.
struct InstitutionLogo: View {
    let logoKey: String?
    let name: String
    var size: CGFloat = 32

    var body: some View {
        Group {
            if let image = logoKey.flatMap({ UIImage(named: "Bank-\($0)") }) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Text(initials)
                    .font(.system(size: size * 0.36, weight: .bold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var initials: String {
        String(name.split(separator: " ").prefix(2).compactMap(\.first)).uppercased()
    }
}

/// A round flag for a payout country.
struct CountryFlag: View {
    let country: Country
    var size: CGFloat = 22

    var body: some View {
        Text(country.flag)
            .font(.system(size: size * 1.3))
            .frame(width: size, height: size)
            .clipShape(Circle())
    }
}

/// A person or account holder: their photo, or their initial on a colour picked from their name.
struct PersonAvatar: View {
    let name: String
    var photoURL: URL?
    var size: CGFloat = 44

    var body: some View {
        Group {
            if let photoURL {
                AsyncImage(url: photoURL) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initial
                }
            } else {
                initial
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var initial: some View {
        Text(String(name.prefix(1)).uppercased())
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(LinearGradient(colors: [tint, tint.opacity(0.45)], startPoint: .topLeading, endPoint: .bottomTrailing))
    }

    private var tint: Color {
        let palette: [Color] = [Color(hex: 0xB0703F), Color(hex: 0x3F5E9A), Color(hex: 0x3E7D66), Color(hex: 0x7A4F8C), Color(hex: 0x4A4A4A)]
        let index = name.unicodeScalars.reduce(0) { ($0 + Int($1.value)) % palette.count }
        return palette[index]
    }
}

/// An avatar with a small badge in its corner: the bank logo, or the NEAR mark for a fliq user.
struct BadgedAvatar<Badge: View>: View {
    let avatar: PersonAvatar
    @ViewBuilder let badge: Badge

    var body: some View {
        avatar.overlay(alignment: .bottomTrailing) {
            badge
                .frame(width: 20, height: 20)
                .background(Circle().fill(Theme.surface).padding(-2))
                .offset(x: 2, y: 2)
        }
    }
}
