namespace StagingArea.Api.Services
{
    public interface IImportService
    {
        Task<ImportResult> ImportCustomersFromSourceAsync(CancellationToken cancellationToken = default);
        Task<ImportResult> ImportOrdersFromSourceAsync(CancellationToken cancellationToken = default);
    }

    public record ImportResult(int Inserted, int Updated, int Invalid, int Total);
}


