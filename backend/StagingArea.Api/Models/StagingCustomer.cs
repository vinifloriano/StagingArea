using System.ComponentModel.DataAnnotations;

namespace StagingArea.Api.Models
{
    public class StagingCustomer
    {
        [Key]
        public int Id { get; set; }

        [MaxLength(100)]
        public string SourceSystem { get; set; } = "unknown";

        [Required]
        [MaxLength(100)]
        public string ExternalId { get; set; } = string.Empty;

        [MaxLength(200)]
        public string? Name { get; set; }

        [MaxLength(200)]
        public string? Email { get; set; }

        public string RawJson { get; set; } = string.Empty;

        public string? TransformJson { get; set; }

        public bool IsValid { get; set; }

        public string? ValidationErrors { get; set; }

        public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    }
}


