import CoreImage.CIFilterBuiltins
import SwiftUI

/// A scannable QR code drawn as dots, with the deposit arrow in a white disc at the centre.
/// The three finder squares stay square because round finders scan badly on older cameras.
struct QRCode: View {
    let text: String

    var body: some View {
        if let matrix = QRMatrix(text: text) {
            Canvas { context, size in
                let cell = size.width / CGFloat(matrix.count)
                for row in 0..<matrix.count {
                    for column in 0..<matrix.count where matrix[row, column] && !matrix.isFinder(row, column) {
                        let dot = CGRect(x: CGFloat(column) * cell, y: CGFloat(row) * cell, width: cell, height: cell)
                            .insetBy(dx: cell * 0.08, dy: cell * 0.08)
                        context.fill(Path(ellipseIn: dot), with: .color(.black))
                    }
                }
                for origin in matrix.finderOrigins {
                    drawFinder(at: origin, cell: cell, in: context)
                }
            }
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(.black)
                    .frame(width: 44, height: 44)
                    .background(.white, in: Circle())
            }
            .accessibilityElement()
            .accessibilityLabel("QR code of the deposit address")
        }
    }

    private func drawFinder(at origin: (row: Int, column: Int), cell: CGFloat, in context: GraphicsContext) {
        let outer = CGRect(x: CGFloat(origin.column) * cell, y: CGFloat(origin.row) * cell, width: cell * 7, height: cell * 7)
        context.stroke(
            Path(roundedRect: outer.insetBy(dx: cell / 2, dy: cell / 2), cornerRadius: cell * 1.6),
            with: .color(.black),
            lineWidth: cell
        )
        context.fill(Path(roundedRect: outer.insetBy(dx: cell * 2, dy: cell * 2), cornerRadius: cell * 0.9), with: .color(.black))
    }
}

private struct QRMatrix {
    let count: Int
    private let modules: [Bool]

    init?(text: String) {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "Q"
        guard let output = filter.outputImage,
              let image = CIContext().createCGImage(output, from: output.extent),
              let pixels = image.dataProvider?.data,
              let bytes = CFDataGetBytePtr(pixels)
        else { return nil }
        let size = image.width
        let stride = image.bytesPerRow
        let step = image.bitsPerPixel / 8
        var all: [Bool] = []
        for row in 0..<size {
            for column in 0..<size { all.append(bytes[row * stride + column * step] < 128) }
        }
        let margin = Self.quietZone(all, size: size)
        count = size - margin * 2
        var cropped: [Bool] = []
        for row in margin..<(size - margin) {
            for column in margin..<(size - margin) { cropped.append(all[row * size + column]) }
        }
        modules = cropped
    }

    subscript(row: Int, column: Int) -> Bool { modules[row * count + column] }

    var finderOrigins: [(row: Int, column: Int)] { [(0, 0), (0, count - 7), (count - 7, 0)] }

    func isFinder(_ row: Int, _ column: Int) -> Bool {
        finderOrigins.contains { row >= $0.row && row < $0.row + 7 && column >= $0.column && column < $0.column + 7 }
    }

    private static func quietZone(_ modules: [Bool], size: Int) -> Int {
        var margin = 0
        while margin < size / 2, !modules[margin * size + margin] { margin += 1 }
        return margin
    }
}
