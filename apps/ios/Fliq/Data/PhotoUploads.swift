import Foundation
import UIKit

/// Puts a profile photo in public storage and returns its https URL, which `PATCH /me` then records.
protocol PhotoUploads: Sendable {
    func upload(_ jpeg: Data) async throws -> URL
}

struct PhotoUploadError: Error, Equatable {
    let message: String
}

/// Cloudinary's unsigned upload: the app only knows the cloud name and an upload preset, never an API secret.
/// The preset decides the folder, size limit and allowed formats, so it is set up in the Cloudinary dashboard.
struct CloudinaryUploads: PhotoUploads {
    let cloud: String
    let preset: String
    var session: URLSession = .shared

    func upload(_ jpeg: Data) async throws -> URL {
        guard let endpoint = URL(string: "https://api.cloudinary.com/v1_1/\(cloud)/image/upload") else {
            throw PhotoUploadError(message: "bad cloud name")
        }
        let boundary = "fliq-\(UUID().uuidString)"
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = Self.form(jpeg, preset: preset, boundary: boundary)

        let (data, response) = try await session.data(for: request)
        let reply = try? JSONDecoder().decode(Reply.self, from: data)
        guard (response as? HTTPURLResponse)?.statusCode == 200, let url = reply?.secureURL.flatMap(URL.init(string:)) else {
            throw PhotoUploadError(message: reply?.error?.message ?? "upload failed")
        }
        return url
    }

    static func form(_ jpeg: Data, preset: String, boundary: String) -> Data {
        var body = Data()
        func line(_ text: String) { body.append(Data((text + "\r\n").utf8)) }
        line("--\(boundary)")
        line(#"Content-Disposition: form-data; name="upload_preset""#)
        line("")
        line(preset)
        line("--\(boundary)")
        line(#"Content-Disposition: form-data; name="file"; filename="photo.jpg""#)
        line("Content-Type: image/jpeg")
        line("")
        body.append(jpeg)
        line("")
        line("--\(boundary)--")
        return body
    }

    private struct Reply: Decodable {
        struct Failure: Decodable { let message: String }
        let secureURL: String?
        let error: Failure?
        enum CodingKeys: String, CodingKey {
            case secureURL = "secure_url"
            case error
        }
    }
}

/// The demo build stores nothing: it hands back a placeholder so the flow can be shown end to end.
struct FixturePhotoUploads: PhotoUploads {
    func upload(_ jpeg: Data) async throws -> URL {
        URL(string: "https://res.cloudinary.com/demo/image/upload/sample.jpg")!
    }
}

enum ProfilePhoto {
    static let side: CGFloat = 512

    /// A square, centred crop at 512 points and JPEG quality 0.82: about 60 KB, small enough to upload on a weak
    /// connection and sharp enough for the largest avatar the app draws.
    static func prepare(_ data: Data) -> Data? {
        guard let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 else { return nil }
        let shortest = min(image.size.width, image.size.height)
        let scale = side / shortest
        let drawn = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let square = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
            image.draw(in: CGRect(x: (side - drawn.width) / 2, y: (side - drawn.height) / 2, width: drawn.width, height: drawn.height))
        }
        return square.jpegData(compressionQuality: 0.82)
    }
}
